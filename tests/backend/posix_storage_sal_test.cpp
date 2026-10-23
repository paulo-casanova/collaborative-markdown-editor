#include "cme/storage/posix_storage_backend.hpp"
#include "cme/config/config.hpp"
#include <cassert>
#include <iostream>
#include <thread>
#include <vector>
#include <algorithm>
#include <filesystem>

using namespace cme::storage;

int main() {
    std::filesystem::path test_root = std::filesystem::temp_directory_path() / "cme_sal_test_root";
    std::filesystem::remove_all(test_root);

    std::cout << "[TEST] Initializing PosixStorageBackend at: " << test_root << "\n";
    PosixStorageBackend backend(test_root);

    assert(std::filesystem::exists(backend.content_root()));
    assert(std::filesystem::exists(backend.trash_root()));

    // 1. Basic Write & Read
    std::cout << "[TEST] 1. Basic Write & Read...\n";
    auto w_res = backend.write_file("guides/intro.md", "# Introduction\nWelcome to CME.");
    assert(w_res.has_value());

    auto r_res = backend.read_file("guides/intro.md");
    assert(r_res.has_value());
    assert(*r_res == "# Introduction\nWelcome to CME.");

    // Path traversal rejection
    auto trav_res = backend.read_file("../escape.md");
    assert(!trav_res.has_value());
    assert(trav_res.error() == cme::ErrorCode::InvalidArgument);

    // 2. Atomic Overwrites
    std::cout << "[TEST] 2. Atomic Overwrite...\n";
    auto w_over = backend.write_file("guides/intro.md", "# Introduction v2\nUpdated content.");
    assert(w_over.has_value());
    assert(*backend.read_file("guides/intro.md") == "# Introduction v2\nUpdated content.");

    // 3. Document Bundle Detection
    std::cout << "[TEST] 3. Document Bundle Detection...\n";
    // Standalone file is not a bundle
    assert(!*backend.is_bundle("guides/intro.md"));

    // Directory with .bundle extension is recognized as bundle
    backend.create_directory("projects/alpha.bundle");
    backend.write_file("projects/alpha.bundle/notes.txt", "Some notes");
    assert(*backend.is_bundle("projects/alpha.bundle"));

    // Directory with index.md but not named .bundle is NOT a bundle
    backend.create_directory("projects/beta");
    backend.write_file("projects/beta/index.md", "# Beta Document");
    assert(!*backend.is_bundle("projects/beta"));

    // Directory with <dirname>.md but not named .bundle is NOT a bundle
    backend.create_directory("projects/project-gamma");
    backend.write_file("projects/project-gamma/project-gamma.md", "# Gamma Document");
    assert(!*backend.is_bundle("projects/project-gamma"));

    // 4. Moving Nodes & Bundles
    std::cout << "[TEST] 4. Moving Nodes & Bundles...\n";
    auto move_file = backend.move_node("guides/intro.md", "archive/guides/intro_old.md");
    assert(move_file.has_value());
    assert(!*backend.exists("guides/intro.md"));
    assert(*backend.exists("archive/guides/intro_old.md"));
    assert(*backend.read_file("archive/guides/intro_old.md") == "# Introduction v2\nUpdated content.");

    // Move entire bundle directory
    auto move_bundle = backend.move_node("projects/alpha.bundle", "archive/projects/alpha.bundle");
    assert(move_bundle.has_value());
    assert(!*backend.exists("projects/alpha.bundle"));
    assert(*backend.exists("archive/projects/alpha.bundle/notes.txt"));

    // 5. Soft-Delete to Trash & Restore Lifecycle
    std::cout << "[TEST] 5. Trash Lifecycle...\n";
    auto trash_id_res = backend.delete_to_trash("archive/guides/intro_old.md");
    assert(trash_id_res.has_value());
    std::string trash_id = *trash_id_res;
    std::cout << "  Deleted to trash ID: " << trash_id << "\n";

    assert(!*backend.exists("archive/guides/intro_old.md"));

    // Verify listed in trash
    auto trash_list = backend.list_trash();
    assert(trash_list.has_value());
    assert(!trash_list->empty());
    bool found_in_trash = false;
    for (const auto& item : *trash_list) {
        if (item.name == trash_id) {
            found_in_trash = true;
            assert(item.relative_path == "archive/guides/intro_old.md");
            break;
        }
    }
    assert(found_in_trash);

    // Restore from trash
    auto restore_res = backend.restore_from_trash(trash_id, "restored/intro.md");
    assert(restore_res.has_value());
    assert(*backend.exists("restored/intro.md"));
    assert(*backend.read_file("restored/intro.md") == "# Introduction v2\nUpdated content.");

    // Delete again and purge permanently
    auto trash_id2 = *backend.delete_to_trash("restored/intro.md");
    auto purge_res = backend.purge_from_trash(trash_id2);
    assert(purge_res.has_value());
    auto trash_list_after = backend.list_trash();
    assert(trash_list_after.has_value());
    for (const auto& item : *trash_list_after) {
        assert(item.name != trash_id2);
    }

    // 6. Directory Listing (Flat & Recursive)
    std::cout << "[TEST] 6. Directory Listing...\n";
    backend.write_file("tree/a/1.md", "1");
    backend.write_file("tree/a/2.md", "2");
    backend.write_file("tree/b/3.md", "3");

    auto flat_list = backend.list_directory("tree", false);
    assert(flat_list.has_value());
    assert(flat_list->size() == 2); // 'a' and 'b'

    auto rec_list = backend.list_directory("tree", true);
    assert(rec_list.has_value());
    assert(rec_list->size() == 5); // 'a', 'a/1.md', 'a/2.md', 'b', 'b/3.md'

    // 7. Concurrent Writes Stress Test (1,000 files across 10 threads)
    std::cout << "[TEST] 7. Concurrent Writes Stress Test (1,000 files across 10 threads)...\n";
    constexpr int NUM_THREADS = 10;
    constexpr int FILES_PER_THREAD = 100;
    std::vector<std::thread> workers;
    workers.reserve(NUM_THREADS);

    for (int t = 0; t < NUM_THREADS; ++t) {
        workers.emplace_back([&backend, t]() {
            for (int f = 0; f < FILES_PER_THREAD; ++f) {
                std::string path = "concurrent/thread_" + std::to_string(t) + "/doc_" + std::to_string(f) + ".md";
                std::string payload = "Thread " + std::to_string(t) + " Document " + std::to_string(f);
                auto res = backend.write_file(path, payload, true);
                assert(res.has_value());

                auto read_back = backend.read_file(path);
                assert(read_back.has_value());
                assert(*read_back == payload);
            }
        });
    }

    for (auto& w : workers) {
        w.join();
    }

    std::cout << "  Verifying 1,000 written files on disk...\n";
    auto conc_files = backend.list_directory("concurrent", true);
    assert(conc_files.has_value());
    // 10 thread dirs + 1,000 files = 1,010 entries
    assert(conc_files->size() == 1010);
    std::cout << "  All 1,000 files written and verified without race conditions.\n";

    // 8. Storage Health & Factory Resolution
    std::cout << "[TEST] 8. Storage Health & Factory Resolution...\n";
    auto health_res = backend.check_health();
    assert(health_res.has_value());
    assert(health_res->status == "writable");
    assert(health_res->backend_type == "posix");
    assert(health_res->free_bytes.has_value() && *health_res->free_bytes > 0);

    cme::config::StorageConfig posix_cfg;
    posix_cfg.backend = "posix";
    posix_cfg.root_path = (test_root / "factory").string();
    auto factory_posix = create_storage_backend(posix_cfg);
    assert(factory_posix.has_value());
    assert(*factory_posix != nullptr);

    cme::config::StorageConfig s3_cfg;
    s3_cfg.backend = "s3";
    s3_cfg.s3_bucket = "my-test-bucket";
    auto factory_s3 = create_storage_backend(s3_cfg);
    assert(!factory_s3.has_value());
    assert(factory_s3.error() == cme::ErrorCode::InvalidArgument);

    cme::config::StorageConfig invalid_cfg;
    invalid_cfg.backend = "invalid_unknown";
    auto factory_inv = create_storage_backend(invalid_cfg);
    assert(!factory_inv.has_value());
    assert(factory_inv.error() == cme::ErrorCode::InvalidArgument);

    // 9. Multi-Mount Virtual Routing, CRUD, Listings, Cross-Mount Moves, and Trash
    std::cout << "[TEST] 9. Multi-Mount Virtual Routing, CRUD, Listings, Cross-Mount Moves, and Trash...\n";
    std::filesystem::path mount_specs = std::filesystem::temp_directory_path() / "cme_sal_mount_specs";
    std::filesystem::path mount_notes = std::filesystem::temp_directory_path() / "cme_sal_mount_notes";
    std::filesystem::remove_all(mount_specs);
    std::filesystem::remove_all(mount_notes);

    std::vector<cme::config::StorageMountConfig> mounts = {
        {"specs", mount_specs.string()},
        {"notes", mount_notes.string()}
    };

    PosixStorageBackend mm_backend(test_root / "multi_mount", mounts);

    // Verify configured mounts accessor
    assert(mm_backend.mounts().size() == 2);
    assert(std::filesystem::exists(mount_specs));
    assert(std::filesystem::exists(mount_notes));

    // A. Write to mount and verify physical host path
    auto mw_res = mm_backend.write_file("specs/arch.md", "# Architecture Spec\nDistributed layout.");
    assert(mw_res.has_value());
    assert(std::filesystem::exists(mount_specs / "arch.md"));
    assert(!std::filesystem::exists(mm_backend.content_root() / "specs" / "arch.md"));

    // B. Read from mount
    auto mr_res = mm_backend.read_file("specs/arch.md");
    assert(mr_res.has_value());
    assert(*mr_res == "# Architecture Spec\nDistributed layout.");

    // C. Write to second mount
    auto nw_res = mm_backend.write_file("notes/meeting.md", "Team notes for Friday.");
    assert(nw_res.has_value());
    assert(std::filesystem::exists(mount_notes / "meeting.md"));
    assert(*mm_backend.read_file("notes/meeting.md") == "Team notes for Friday.");

    // D. Write to default storage
    auto dw_res = mm_backend.write_file("default.md", "Default root content.");
    assert(dw_res.has_value());
    assert(std::filesystem::exists(mm_backend.content_root() / "default.md"));

    // E. Directory listings
    // Flat listing at root "" must include mounts and default files
    auto mm_root_flat = mm_backend.list_directory("", false);
    assert(mm_root_flat.has_value());
    bool found_specs = false;
    bool found_notes = false;
    bool found_default = false;
    for (const auto& item : *mm_root_flat) {
        if (item.relative_path == "specs") {
            found_specs = true;
            assert(item.is_directory);
        }
        if (item.relative_path == "notes") {
            found_notes = true;
            assert(item.is_directory);
        }
        if (item.relative_path == "default.md") {
            found_default = true;
            assert(!item.is_directory);
        }
    }
    assert(found_specs && found_notes && found_default);

    // Sub-mount listing
    auto mm_specs_flat = mm_backend.list_directory("specs", false);
    assert(mm_specs_flat.has_value());
    assert(mm_specs_flat->size() == 1);
    assert(mm_specs_flat->front().name == "arch.md");
    assert(mm_specs_flat->front().relative_path == "specs/arch.md");

    // Recursive listing at root
    auto mm_root_rec = mm_backend.list_directory("", true);
    assert(mm_root_rec.has_value());
    bool found_specs_arch = false;
    bool found_notes_meeting = false;
    for (const auto& item : *mm_root_rec) {
        if (item.relative_path == "specs/arch.md") found_specs_arch = true;
        if (item.relative_path == "notes/meeting.md") found_notes_meeting = true;
    }
    assert(found_specs_arch && found_notes_meeting);

    // F. Bundle detection in mount
    mm_backend.create_directory("specs/bundle.bundle");
    mm_backend.write_file("specs/bundle.bundle/index.md", "# Bundle");
    assert(*mm_backend.is_bundle("specs/bundle.bundle"));

    // G. Cross-mount moving
    // Move from default storage to mount "specs"
    auto move_to_mount = mm_backend.move_node("default.md", "specs/imported_default.md");
    assert(move_to_mount.has_value());
    assert(!*mm_backend.exists("default.md"));
    assert(*mm_backend.exists("specs/imported_default.md"));
    assert(std::filesystem::exists(mount_specs / "imported_default.md"));
    assert(*mm_backend.read_file("specs/imported_default.md") == "Default root content.");

    // Move between two mounts ("specs" -> "notes")
    auto move_cross_mount = mm_backend.move_node("specs/imported_default.md", "notes/final_doc.md");
    assert(move_cross_mount.has_value());
    assert(!*mm_backend.exists("specs/imported_default.md"));
    assert(*mm_backend.exists("notes/final_doc.md"));
    assert(std::filesystem::exists(mount_notes / "final_doc.md"));
    assert(*mm_backend.read_file("notes/final_doc.md") == "Default root content.");

    // H. Soft-delete from mount to trash & restore
    auto trash_res_mm = mm_backend.delete_to_trash("notes/final_doc.md");
    assert(trash_res_mm.has_value());
    assert(!*mm_backend.exists("notes/final_doc.md"));
    assert(!std::filesystem::exists(mount_notes / "final_doc.md"));

    auto restore_res_mm = mm_backend.restore_from_trash(*trash_res_mm, "notes/restored_doc.md");
    assert(restore_res_mm.has_value());
    assert(*mm_backend.exists("notes/restored_doc.md"));
    assert(std::filesystem::exists(mount_notes / "restored_doc.md"));
    assert(*mm_backend.read_file("notes/restored_doc.md") == "Default root content.");

    // Clean up mount sandboxes
    std::filesystem::remove_all(mount_specs);
    std::filesystem::remove_all(mount_notes);

    // 10. CLI & Config Multi-Mount Parsing Test
    std::cout << "[TEST] 10. CLI & Config Multi-Mount Parsing Test...\n";
    const char* mock_argv[] = {
        "cme-server",
        "--mount", "wiki=/tmp/cme_wiki",
        "--mounts", "specs=/tmp/cme_specs,notes=/tmp/cme_notes"
    };
    int mock_argc = sizeof(mock_argv) / sizeof(mock_argv[0]);
    auto cli_cfg = cme::config::AppConfig::load(mock_argc, const_cast<char**>(mock_argv));
    assert(cli_cfg.has_value());
    assert(cli_cfg->storage.mounts.size() == 3);
    assert(cli_cfg->storage.mounts[0].prefix == "wiki" && cli_cfg->storage.mounts[0].path == "/tmp/cme_wiki");
    assert(cli_cfg->storage.mounts[1].prefix == "specs" && cli_cfg->storage.mounts[1].path == "/tmp/cme_specs");
    assert(cli_cfg->storage.mounts[2].prefix == "notes" && cli_cfg->storage.mounts[2].path == "/tmp/cme_notes");

    // Clean up test sandbox
    std::filesystem::remove_all(test_root);

    std::cout << "\n[PASS] All posix_storage_sal_test test cases succeeded!\n";
    return 0;
}
