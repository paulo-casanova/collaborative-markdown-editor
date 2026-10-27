#include "cme/storage/posix_storage_backend.hpp"
#include <cassert>
#include <iostream>
#include <filesystem>
#include <atomic>
#include <dlfcn.h>
#include <unistd.h>
#include <sys/stat.h>

static std::atomic<int> g_file_fsync_count{0};
static std::atomic<int> g_dir_fsync_count{0};

extern "C" int fsync(int fd) {
    struct stat st{};
    if (fstat(fd, &st) == 0) {
        if (S_ISDIR(st.st_mode)) {
            g_dir_fsync_count++;
        } else if (S_ISREG(st.st_mode)) {
            g_file_fsync_count++;
        }
    }
    static auto real_fsync = (int(*)(int))dlsym(RTLD_NEXT, "fsync");
    return real_fsync ? real_fsync(fd) : 0;
}

extern "C" int fdatasync(int fd) {
    struct stat st{};
    if (fstat(fd, &st) == 0) {
        if (S_ISDIR(st.st_mode)) {
            g_dir_fsync_count++;
        } else if (S_ISREG(st.st_mode)) {
            g_file_fsync_count++;
        }
    }
    static auto real_fdatasync = (int(*)(int))dlsym(RTLD_NEXT, "fdatasync");
    return real_fdatasync ? real_fdatasync(fd) : 0;
}

int main() {
    std::cout << "====================================================================\n";
    std::cout << "=== CME POSIX Storage Durable Writes Regression Test (Issue #28) ===\n";
    std::cout << "====================================================================\n";

    std::filesystem::path test_root = std::filesystem::temp_directory_path() / "cme_durable_test_storage";
    std::filesystem::remove_all(test_root);

    cme::storage::PosixStorageBackend backend(test_root);

    // Test 1: Atomic write_file (must fsync both temporary file and directory)
    std::cout << "[TEST 1] Testing atomic write_file durability...\n";
    g_file_fsync_count = 0;
    g_dir_fsync_count = 0;

    auto w1 = backend.write_file("sub/durable_doc.md", "# Durable Content\n", true);
    assert(w1.has_value());
    assert(g_file_fsync_count.load() >= 1);
    assert(g_dir_fsync_count.load() >= 1);

    auto r1 = backend.read_file("sub/durable_doc.md");
    assert(r1.has_value());
    assert(*r1 == "# Durable Content\n");
    std::cout << "  - Verified: file fsync count=" << g_file_fsync_count.load()
              << ", dir fsync count=" << g_dir_fsync_count.load() << "\n";

    // Test 2: Non-atomic write_file (must fsync target file)
    std::cout << "[TEST 2] Testing non-atomic write_file durability...\n";
    g_file_fsync_count = 0;
    g_dir_fsync_count = 0;

    auto w2 = backend.write_file("direct.md", "# Direct Content\n", false);
    assert(w2.has_value());
    assert(g_file_fsync_count.load() >= 1);

    auto r2 = backend.read_file("direct.md");
    assert(r2.has_value());
    assert(*r2 == "# Direct Content\n");
    std::cout << "  - Verified: direct file fsync count=" << g_file_fsync_count.load() << "\n";

    // Test 3: Snapshot creation durability
    std::cout << "[TEST 3] Testing create_snapshot durability...\n";
    g_file_fsync_count = 0;
    g_dir_fsync_count = 0;

    auto snap_res = backend.create_snapshot("sub/durable_doc.md", "# Snapshot Content\n");
    assert(snap_res.has_value());
    assert(g_file_fsync_count.load() >= 1);
    assert(g_dir_fsync_count.load() >= 1);
    std::cout << "  - Verified: snapshot file fsync count=" << g_file_fsync_count.load()
              << ", dir fsync count=" << g_dir_fsync_count.load() << "\n";

    // Test 4: Binary CRDT state durability
    std::cout << "[TEST 4] Testing save_crdt_state durability...\n";
    g_file_fsync_count = 0;
    g_dir_fsync_count = 0;

    std::vector<uint8_t> dummy_crdt = {0x01, 0x02, 0x03, 0x04, 0xff};
    auto crdt_res = backend.save_crdt_state("test-doc-uuid-1234", dummy_crdt);
    assert(crdt_res.has_value());
    assert(g_file_fsync_count.load() >= 1);
    assert(g_dir_fsync_count.load() >= 1);

    auto load_crdt = backend.load_crdt_state("test-doc-uuid-1234");
    assert(load_crdt.has_value());
    assert(*load_crdt == dummy_crdt);
    std::cout << "  - Verified: CRDT state file fsync count=" << g_file_fsync_count.load()
              << ", dir fsync count=" << g_dir_fsync_count.load() << "\n";

    std::filesystem::remove_all(test_root);

    std::cout << "====================================================================\n";
    std::cout << "=== ALL CHECKS PASSED: Issue #28 Regression Test Succeeded       ===\n";
    std::cout << "====================================================================\n";

    return 0;
}
