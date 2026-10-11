#include "cme/collab/crdt_doc.hpp"
#include "cme/collab/document_room.hpp"
#include "cme/collab/room_manager.hpp"
#include <cassert>
#include <iostream>
#include <string>
#include <vector>

using namespace cme::collab;

int main() {
    std::cout << "========================================================\n";
    std::cout << "=== Native Yjs CRDT C-FFI Integration Test Suite     ===\n";
    std::cout << "========================================================\n";

    // -------------------------------------------------------------------------
    // TEST 1: CrdtDoc Basic Operations & Bidirectional Text Serialization
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 1] Testing CrdtDoc text operations and serialization...\n";
    {
        CrdtDoc doc;
        assert(doc.get_text().empty());
        assert(doc.get_text_length() == 0);

        doc.insert_text(0, "Hello World!");
        assert(doc.get_text() == "Hello World!");
        assert(doc.get_text_length() == 12);

        // Insert at offset
        doc.insert_text(5, " Beautiful");
        assert(doc.get_text() == "Hello Beautiful World!");

        // Delete range
        doc.delete_text(5, 10); // delete " Beautiful"
        assert(doc.get_text() == "Hello World!");

        // Overwrite full text
        doc.set_text("# Collaborative Markdown Editor\n\nLive editing test.");
        assert(doc.get_text() == "# Collaborative Markdown Editor\n\nLive editing test.");

        std::cout << "  [PASS] CrdtDoc text insertions, deletions, and set_text verified.\n";
    }

    // -------------------------------------------------------------------------
    // TEST 2: Two-Party Bidirectional Sync (SyncStep1 -> SyncStep2)
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 2] Testing two-party Yjs binary sync protocol...\n";
    {
        CrdtDoc doc_alice;
        doc_alice.set_text("Initial Alice Document Content");

        CrdtDoc doc_bob; // Empty Bob document

        // 1. Bob generates his local State Vector (SyncStep1)
        auto bob_sv = doc_bob.get_state_vector();
        assert(!bob_sv.empty());

        // 2. Alice computes differential delta against Bob's SV (SyncStep2)
        auto alice_diff = doc_alice.get_state_diff(bob_sv);
        assert(!alice_diff.empty());

        // 3. Bob applies Alice's delta
        auto apply_res = doc_bob.apply_update(alice_diff);
        assert(apply_res.has_value());

        // 4. Bob now has identical content
        assert(doc_bob.get_text() == doc_alice.get_text());
        assert(doc_bob.get_text() == "Initial Alice Document Content");
        std::cout << "  [PASS] Initial state synchronization (SyncStep1 -> SyncStep2) verified.\n";
    }

    // -------------------------------------------------------------------------
    // TEST 3: Out-of-Order Concurrent Editing & Conflict-Free Convergence
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 3] Testing concurrent out-of-order edits and convergence...\n";
    {
        // Setup initial synchronized state in both rooms
        std::string base_text = "The quick brown fox jumps over the lazy dog.";
        DocumentRoom room_a("doc-1", base_text, "notes/sample.md");
        DocumentRoom room_b("doc-1", "", "notes/sample.md");

        // Sync initial state from room_a to room_b
        auto sv_b = room_b.get_state_vector();
        auto diff_a = room_a.compute_sync_step2(sv_b);
        assert(room_b.apply_client_update(diff_a).has_value());
        assert(room_a.get_content() == room_b.get_content());
        assert(room_b.get_content() == base_text);

        // Simulate concurrent edits:
        // Room A inserts "very " before "quick" at offset 4
        room_a.insert_text(4, "very ");

        // Room B inserts "extremely " before "lazy" at offset 35, and appends " in the park."
        room_b.insert_text(35, "extremely ");
        uint32_t len_b = static_cast<uint32_t>(room_b.get_content().size());
        room_b.insert_text(len_b - 1, " in the park");

        // Verify divergence before sync
        assert(room_a.get_content() != room_b.get_content());
        std::cout << "  Room A text: \"" << room_a.get_content() << "\"\n";
        std::cout << "  Room B text: \"" << room_b.get_content() << "\"\n";

        // Exchange updates (A -> B and B -> A)
        auto sv_a_cur = room_a.get_state_vector();
        auto sv_b_cur = room_b.get_state_vector();

        auto delta_for_b = room_a.compute_sync_step2(sv_b_cur);
        auto delta_for_a = room_b.compute_sync_step2(sv_a_cur);

        assert(room_b.apply_client_update(delta_for_b).has_value());
        assert(room_a.apply_client_update(delta_for_a).has_value());

        // Assert convergence to identical string
        std::cout << "  Converged text: \"" << room_a.get_content() << "\"\n";
        assert(room_a.get_content() == room_b.get_content());
        assert(room_a.get_content().find("very quick") != std::string::npos);
        assert(room_a.get_content().find("extremely lazy") != std::string::npos);
        assert(room_a.get_content().find("in the park") != std::string::npos);

        std::cout << "  [PASS] Concurrent editing arrived at identical converged content.\n";
    }

    // -------------------------------------------------------------------------
    // TEST 4: Three-Peer Diamond Convergence
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 4] Testing three-peer diamond CRDT reconciliation...\n";
    {
        DocumentRoom peer1("doc-diamond", "Base");
        DocumentRoom peer2("doc-diamond", "");
        DocumentRoom peer3("doc-diamond", "");

        // Initial sync from peer1 to peer2 and peer3
        peer2.apply_client_update(peer1.compute_sync_step2(peer2.get_state_vector()));
        peer3.apply_client_update(peer1.compute_sync_step2(peer3.get_state_vector()));
        assert(peer2.get_content() == "Base");
        assert(peer3.get_content() == "Base");

        // Independent edits
        peer1.insert_text(4, " [Edit1]");
        peer2.insert_text(4, " [Edit2]");
        peer3.insert_text(4, " [Edit3]");

        // Round-robin merge
        // Peer 1 sends to Peer 2 and 3
        peer2.apply_client_update(peer1.compute_sync_step2(peer2.get_state_vector()));
        peer3.apply_client_update(peer1.compute_sync_step2(peer3.get_state_vector()));

        // Peer 2 sends to Peer 1 and 3
        peer1.apply_client_update(peer2.compute_sync_step2(peer1.get_state_vector()));
        peer3.apply_client_update(peer2.compute_sync_step2(peer3.get_state_vector()));

        // Peer 3 sends to Peer 1 and 2
        peer1.apply_client_update(peer3.compute_sync_step2(peer1.get_state_vector()));
        peer2.apply_client_update(peer3.compute_sync_step2(peer2.get_state_vector()));

        // All 3 peers must have exact same string
        assert(peer1.get_content() == peer2.get_content());
        assert(peer2.get_content() == peer3.get_content());
        std::cout << "  3-Peer Converged text: \"" << peer1.get_content() << "\"\n";
        std::cout << "  [PASS] Three-peer diamond reconciliation verified.\n";
    }

    // -------------------------------------------------------------------------
    // TEST 5: DocumentRoom Lifecycle, Dirty State & Peer Presence
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 5] Testing DocumentRoom dirty tracking and peer presence...\n";
    {
        DocumentRoom room("doc-lifecycle", "Initial Text", "docs/spec.md");
        assert(room.document_id() == "doc-lifecycle");
        assert(room.fs_path() == "docs/spec.md");
        assert(room.is_dirty() == false);
        assert(room.peer_count() == 0);

        // Edit marks dirty
        room.insert_text(0, "Header: ");
        assert(room.is_dirty() == true);
        assert(room.get_content() == "Header: Initial Text");

        // Mark clean
        room.mark_clean();
        assert(room.is_dirty() == false);

        // Peer presence
        room.add_peer("client-1", "alice", "Alice Admin", "#10b981");
        room.add_peer("client-2", "bob", "Bob Dev", "#3b82f6");
        assert(room.peer_count() == 2);

        auto peers = room.list_peers();
        assert(peers.size() == 2);

        room.remove_peer("client-1");
        assert(room.peer_count() == 1);
        assert(room.list_peers()[0].username == "bob");

        std::cout << "  [PASS] DocumentRoom dirty tracking and peer presence validated.\n";
    }

    // -------------------------------------------------------------------------
    // TEST 6: RoomManager Coordination
    // -------------------------------------------------------------------------
    std::cout << "\n[TEST 6] Testing RoomManager coordination...\n";
    {
        RoomManager manager;
        assert(manager.active_room_count() == 0);

        auto r1 = manager.get_or_create_room("doc-1", "# Doc 1", "guides/doc1.md");
        assert(r1 != nullptr);
        assert(manager.active_room_count() == 1);

        auto r1_again = manager.get_room("doc-1");
        assert(r1 == r1_again);

        auto r2 = manager.get_or_create_room("doc-2", "# Doc 2", "guides/doc2.md");
        assert(manager.active_room_count() == 2);

        // Dirty tracking across manager
        assert(manager.get_dirty_rooms().empty());
        r2->insert_text(7, " Edited");
        auto dirty = manager.get_dirty_rooms();
        assert(dirty.size() == 1);
        assert(dirty[0]->document_id() == "doc-2");

        // Eviction
        assert(manager.remove_room("doc-1"));
        assert(manager.active_room_count() == 1);
        assert(manager.get_room("doc-1") == nullptr);

        std::cout << "  [PASS] RoomManager room lifecycle and dirty querying validated.\n";
    }

    std::cout << "\n[SUCCESS] Step 3.1 Native Yjs CRDT C-FFI Integration Test Suite passed 100%!\n";
    return 0;
}
