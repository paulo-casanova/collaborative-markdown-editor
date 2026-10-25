#include "cme/collab/document_room.hpp"
#include "cme/collab/persistence_worker.hpp"
#include "cme/collab/room_manager.hpp"
#include "cme/storage/posix_storage_backend.hpp"
#include <cassert>
#include <iostream>
#include <filesystem>
#include <functional>

namespace {

class InterceptingStorageBackend : public cme::storage::PosixStorageBackend {
public:
    using PosixStorageBackend::PosixStorageBackend;

    std::function<void(const std::string& relative_path)> on_before_write;

    cme::Result<void> write_file(
        const std::string& relative_path,
        std::string_view content,
        bool create_parents
    ) override {
        if (on_before_write) {
            on_before_write(relative_path);
        }
        return PosixStorageBackend::write_file(relative_path, content, create_parents);
    }
};

} // namespace

int main() {
    std::cout << "====================================================================\n";
    std::cout << "=== CME Persistence Concurrent Edit Protection Test (Issue #20)  ===\n";
    std::cout << "====================================================================\n";

    auto temp_dir = std::filesystem::temp_directory_path() / "cme_persist_concurrent_test";
    std::filesystem::remove_all(temp_dir);
    std::filesystem::create_directories(temp_dir);

    auto storage = std::make_shared<InterceptingStorageBackend>(temp_dir);
    auto room_mgr = std::make_shared<cme::collab::RoomManager>();

    std::string doc_id = "test-doc-issue-20";
    std::string rel_path = "notes/document.md";
    std::string initial_content = "Initial content.";

    auto init_res = storage->write_file(rel_path, initial_content, true);
    assert(init_res.has_value());

    auto room = room_mgr->get_or_create_room(doc_id, initial_content, rel_path);
    assert(!room->is_dirty());
    assert(room->edit_sequence() == 0);

    room->add_peer("peer_alice", "alice", "Alice", "#3b82f6");
    assert(room->peer_count() == 1);

    cme::collab::PersistenceConfig cfg{
        .idle_delay = std::chrono::milliseconds(50),
        .max_interval = std::chrono::milliseconds(100),
        .check_interval = std::chrono::milliseconds(10),
        .enable_snapshots = true,
        .auto_evict_idle_rooms = true
    };
    cme::collab::PersistenceWorker worker(room_mgr, storage, nullptr, cfg);

    // -------------------------------------------------------------------------
    // Test 1: Baseline clean flush without concurrent edits
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 1] Standard single-edit flush without concurrency...\n";
    room->insert_text(static_cast<uint32_t>(room->get_content().size()), " Baseline edit.");
    assert(room->is_dirty());
    assert(room->edit_sequence() == 1);

    auto flush_res = worker.flush_room(*room);
    assert(flush_res.has_value());
    assert(!room->is_dirty()); // cleanly marked clean
    assert(room->edit_sequence() == 1);

    auto disk_check_1 = storage->read_file(rel_path);
    assert(disk_check_1.has_value());
    assert(disk_check_1.value() == "Initial content. Baseline edit.");
    std::cout << "  - Baseline flush verified: content correctly persisted, room marked clean.\n";

    // -------------------------------------------------------------------------
    // Test 2: Concurrent edit during save does NOT clear is_dirty
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 2] Concurrent edit arriving during storage write...\n";
    // Edit 2 arrives:
    room->insert_text(static_cast<uint32_t>(room->get_content().size()), " Edit A.");
    assert(room->is_dirty());
    assert(room->edit_sequence() == 2);

    // Set interception hook: during write_file, Alice types " Edit B (concurrent)!"
    bool concurrent_edit_injected = false;
    storage->on_before_write = [&](const std::string& path) {
        if (!concurrent_edit_injected && path == rel_path) {
            concurrent_edit_injected = true;
            std::cout << "  - [INTERCEPTOR] Injecting concurrent Edit B during flush_room write_file...\n";
            room->insert_text(static_cast<uint32_t>(room->get_content().size()), " Edit B (concurrent).");
            assert(room->edit_sequence() == 3);
            assert(room->is_dirty());
        }
    };

    // Execute flush_room. The snapshot was taken at sequence 2 before Edit B.
    flush_res = worker.flush_room(*room);
    assert(flush_res.has_value());
    assert(concurrent_edit_injected);

    // CRITICAL ASSERTION: The room must remain dirty because Edit B arrived!
    std::cout << "  - Verifying dirty state: room is_dirty = " << (room->is_dirty() ? "true" : "false")
              << ", edit_sequence = " << room->edit_sequence() << "\n";
    assert(room->is_dirty() == true);

    // File on disk only contains Edit A from sequence 2 snapshot
    auto disk_check_2 = storage->read_file(rel_path);
    assert(disk_check_2.has_value());
    assert(disk_check_2.value() == "Initial content. Baseline edit. Edit A.");
    assert(disk_check_2.value().find("Edit B") == std::string::npos);

    // -------------------------------------------------------------------------
    // Test 3: Eviction is blocked while room is dirty even if peers disconnect
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 3] Peer disconnects while room has unflushed concurrent edit...\n";
    room->remove_peer("peer_alice");
    assert(room->peer_count() == 0);

    // Simulating eviction condition: (!room->is_dirty() && room->peer_count() == 0)
    bool can_evict = (!room->is_dirty() && room->peer_count() == 0);
    std::cout << "  - Can evict room? " << (can_evict ? "YES (BUG!)" : "NO (CORRECT)") << "\n";
    assert(!can_evict);
    assert(room_mgr->get_room(doc_id) != nullptr);

    // -------------------------------------------------------------------------
    // Test 4: Subsequent flush persists Edit B and safely marks clean
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 4] Subsequent flush persists Edit B...\n";
    storage->on_before_write = nullptr; // remove interceptor

    flush_res = worker.flush_room(*room);
    assert(flush_res.has_value());
    assert(!room->is_dirty()); // now cleanly flushed up to sequence 3

    auto disk_check_3 = storage->read_file(rel_path);
    assert(disk_check_3.has_value());
    assert(disk_check_3.value() == "Initial content. Baseline edit. Edit A. Edit B (concurrent).");
    std::cout << "  - Disk content verified: \"" << disk_check_3.value() << "\"\n";

    // Now eviction is safe
    can_evict = (!room->is_dirty() && room->peer_count() == 0);
    assert(can_evict);
    bool evicted = room_mgr->remove_room(doc_id);
    assert(evicted);
    assert(room_mgr->get_room(doc_id) == nullptr);
    std::cout << "  - Room safely evicted without data loss.\n";

    // -------------------------------------------------------------------------
    // Test 5: Re-loading from disk contains all edits (Edit A + Edit B)
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 5] Re-loading evicted document into a fresh room...\n";
    auto reloaded_room = room_mgr->get_or_create_room(doc_id, disk_check_3.value(), rel_path);
    assert(reloaded_room->get_content() == "Initial content. Baseline edit. Edit A. Edit B (concurrent).");
    std::cout << "  - Reloaded content verified intact. No data lost!\n";

    std::filesystem::remove_all(temp_dir);

    std::cout << "\n====================================================================\n";
    std::cout << "=== ALL CONCURRENT PERSISTENCE TESTS PASSED SUCCESSFULLY!       ===\n";
    std::cout << "====================================================================\n";
    return 0;
}
