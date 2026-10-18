/**
 * @file integrity_verifier.cpp
 * @brief Offline integrity checking and reconciliation implementation.
 */

#include "cme/document/integrity_verifier.hpp"
#include "cme/db/connection_pool.hpp"
#include "cme/storage/storage_backend.hpp"
#include "cme/storage/posix_storage_backend.hpp"
#include <iostream>
#include <set>
#include <sstream>
#include <filesystem>
#include <pqxx/pqxx>

namespace cme::document {

namespace {

std::string derive_title_from_content_or_path(std::string_view content, std::string_view path) {
    std::string text(content);
    std::istringstream stream(text);
    std::string line;
    while (std::getline(stream, line)) {
        size_t start = line.find_first_not_of(" \t\r\n");
        if (start != std::string::npos && line.compare(start, 2, "# ") == 0) {
            std::string heading = line.substr(start + 2);
            size_t end = heading.find_last_not_of(" \t\r\n");
            if (end != std::string::npos) {
                return heading.substr(0, end + 1);
            }
        }
    }
    std::filesystem::path fp(path);
    std::string stem = fp.stem().string();
    if (stem.empty()) return "Untitled Document";
    return stem;
}

} // namespace

int IntegrityVerifier::run(const config::AppConfig& cfg) {
    std::cout << "\n======================================================================\n";
    std::cout << "=== CME Storage & Database Offline Integrity Verification Tool     ===\n";
    std::cout << "======================================================================\n";
    std::cout << "[INFO] Storage Backend   : " << cfg.storage.backend << "\n";
    std::cout << "[INFO] Storage Root Path : " << cfg.storage.root_path << "\n";
    std::cout << "[INFO] Database Target   : " << cfg.database.url << "\n\n";

    // 1. Initialize Storage Backend
    auto storage_res = storage::create_storage_backend(cfg.storage);
    if (!storage_res.has_value()) {
        std::cerr << "[ERROR] Failed to initialize storage backend ('" << cfg.storage.backend
                  << "'): " << to_string(storage_res.error()) << "\n";
        return 1;
    }
    auto storage = *storage_res;

    // 2. Connect to PostgreSQL
    auto pool = db::ConnectionPool::create(cfg.database.url, 2);
    if (!pool) {
        std::cerr << "[ERROR] Failed to initialize database connection pool for: " << cfg.database.url << "\n";
        return 1;
    }

    auto conn_res = pool->acquire();
    if (!conn_res.has_value()) {
        std::cerr << "[ERROR] Failed to acquire PostgreSQL connection: " << to_string(conn_res.error()) << "\n";
        return 1;
    }

    size_t total_db_docs = 0;
    size_t missing_on_disk = 0;
    size_t total_disk_nodes = 0;
    size_t unindexed_files = 0;
    size_t reconciled_files = 0;
    long orphaned_comments = 0;
    long orphaned_suggestions = 0;
    long orphaned_tasks = 0;

    std::set<std::string> db_paths;

    try {
        pqxx::work tx(conn_res->get());

        // Step 1: Verify every row in documents points to an existing file or bundle on disk
        std::cout << "[STEP 1/3] Verifying database document references against filesystem...\n";
        auto doc_rows = tx.exec("SELECT id::text, fs_path, title FROM documents;");
        total_db_docs = static_cast<size_t>(doc_rows.size());

        for (const auto& r : doc_rows) {
            std::string doc_id = r[0].as<std::string>();
            std::string fs_path = r[1].as<std::string>();

            auto n_info = storage->get_node_info(fs_path);
            if (n_info.has_value() && n_info->is_directory && !fs_path.ends_with(".bundle")) {
                std::cout << "  [DISCREPANCY] DB document '" << fs_path << "' (ID: " << doc_id
                          << ") is a pure directory, not a document. Purging stale record...\n";
                tx.exec("DELETE FROM documents WHERE id = " + tx.quote(doc_id) + "::uuid;");
                continue;
            }

            db_paths.insert(fs_path);

            auto ex_res = storage->exists(fs_path);
            bool exists = ex_res.has_value() && ex_res.value();
            if (!exists) {
                // If not found in primary storage, check if present on filesystem directly
                std::filesystem::path full_p = std::filesystem::path(cfg.storage.root_path) / fs_path;
                if (std::filesystem::exists(full_p)) {
                    exists = true;
                }
            }

            if (!exists) {
                std::cout << "  [DISCREPANCY] DB document '" << fs_path << "' (ID: " << doc_id
                          << ") is missing on filesystem.\n";
                missing_on_disk++;
            }
        }

        // Step 2: Verify every .md file or .bundle on disk has a corresponding database entry
        std::cout << "[STEP 2/3] Scanning storage tree for unindexed Markdown files & bundles...\n";
        auto list_res = storage->list_directory("", true);
        if (list_res.has_value()) {
            for (const auto& node : list_res.value()) {
                if (node.is_directory && !node.is_bundle) continue;
                if (node.relative_path.find("/images/") != std::string::npos ||
                    node.relative_path.find(".bundle/") != std::string::npos ||
                    node.relative_path.find("backups") == 0 ||
                    node.relative_path.find("trash") == 0) {
                    continue;
                }

                total_disk_nodes++;

                if (!db_paths.contains(node.relative_path)) {
                    unindexed_files++;
                    std::cout << "  [DISCREPANCY] File on disk '" << node.relative_path
                              << "' has no database entry. Reconciling metadata stub...\n";

                    std::string content;
                    auto read_res = storage->read_file(node.relative_path);
                    if (read_res.has_value()) {
                        content = read_res.value();
                    }

                    std::string title = derive_title_from_content_or_path(content, node.relative_path);
                    tx.exec(
                        "INSERT INTO documents (fs_path, title) VALUES (" +
                        tx.quote(node.relative_path) + ", " + tx.quote(title) +
                        ") ON CONFLICT (fs_path) DO NOTHING;"
                    );
                    reconciled_files++;
                    db_paths.insert(node.relative_path);
                }
            }
        }

        // Step 3: Verify referential integrity of review annotations
        std::cout << "[STEP 3/3] Auditing review annotations referential integrity...\n";
        auto c_res = tx.exec("SELECT count(*) FROM comments WHERE document_id NOT IN (SELECT id FROM documents);");
        orphaned_comments = c_res[0][0].as<long>();

        auto s_res = tx.exec("SELECT count(*) FROM suggestions WHERE document_id NOT IN (SELECT id FROM documents);");
        orphaned_suggestions = s_res[0][0].as<long>();

        auto t_res = tx.exec("SELECT count(*) FROM tasks WHERE document_id NOT IN (SELECT id FROM documents);");
        orphaned_tasks = t_res[0][0].as<long>();

        if (orphaned_comments > 0) {
            std::cout << "  [WARN] Found " << orphaned_comments << " orphaned comment threads.\n";
        }
        if (orphaned_suggestions > 0) {
            std::cout << "  [WARN] Found " << orphaned_suggestions << " orphaned edit suggestions.\n";
        }
        if (orphaned_tasks > 0) {
            std::cout << "  [WARN] Found " << orphaned_tasks << " orphaned review tasks.\n";
        }

        tx.commit();
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] Database query execution failed during verification: " << e.what() << "\n";
        return 1;
    }

    // Output formatted report
    std::cout << "\n======================================================================\n";
    std::cout << "=== Verification & Reconciliation Audit Summary                    ===\n";
    std::cout << "======================================================================\n";
    std::cout << "  Total Documents in DB         : " << total_db_docs << "\n";
    std::cout << "  Total Files Audited on Disk   : " << total_disk_nodes << "\n";
    std::cout << "  Missing Files on Storage      : " << missing_on_disk << "\n";
    std::cout << "  Unindexed Files Found on Disk : " << unindexed_files << "\n";
    std::cout << "  Files Successfully Reconciled : " << reconciled_files << "\n";
    std::cout << "  Orphaned Comments             : " << orphaned_comments << "\n";
    std::cout << "  Orphaned Suggestions          : " << orphaned_suggestions << "\n";
    std::cout << "  Orphaned Tasks                : " << orphaned_tasks << "\n";
    std::cout << "----------------------------------------------------------------------\n";

    size_t unresolved_discrepancies = missing_on_disk + (unindexed_files - reconciled_files)
        + static_cast<size_t>(orphaned_comments + orphaned_suggestions + orphaned_tasks);

    if (unresolved_discrepancies == 0) {
        std::cout << "  [SUCCESS] Offline integrity check passed with 0 discrepancies.\n";
        std::cout << "======================================================================\n\n";
        return 0;
    } else {
        std::cerr << "  [FAILURE] Offline integrity check found " << unresolved_discrepancies << " unresolved discrepancies.\n";
        std::cout << "======================================================================\n\n";
        return 1;
    }
}

} // namespace cme::document
