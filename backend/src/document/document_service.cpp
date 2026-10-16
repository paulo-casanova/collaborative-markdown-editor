#include "cme/document/document_service.hpp"
#include <filesystem>
#include <iostream>
#include <sstream>
#include <algorithm>
#include <cctype>
#include <chrono>
#include <iomanip>
#include <map>

namespace cme::document {

namespace {

std::string normalize_rel_path(std::string_view p) {
    while (!p.empty() && (p.front() == '/' || p.front() == '\\' || std::isspace(static_cast<unsigned char>(p.front())))) {
        p.remove_prefix(1);
    }
    while (!p.empty() && (p.back() == '/' || p.back() == '\\' || std::isspace(static_cast<unsigned char>(p.back())))) {
        p.remove_suffix(1);
    }
    return std::string(p);
}

bool has_path_traversal(std::string_view p) {
    if (p.find("..") != std::string_view::npos) return true;
    return false;
}

std::string derive_title(std::string_view content, std::string_view path) {
    std::string text(content);
    std::istringstream stream(text);
    std::string line;
    while (std::getline(stream, line)) {
        // Trim leading whitespace
        size_t start = line.find_first_not_of(" \t\r\n");
        if (start != std::string::npos && line.compare(start, 2, "# ") == 0) {
            std::string heading = line.substr(start + 2);
            // Trim trailing
            size_t end = heading.find_last_not_of(" \t\r\n");
            if (end != std::string::npos) {
                return heading.substr(0, end + 1);
            }
        }
    }

    // 2. Derive from filename
    std::filesystem::path fp(path);
    std::string stem = fp.stem().string();
    if (!stem.empty()) {
        stem[0] = static_cast<char>(std::toupper(static_cast<unsigned char>(stem[0])));
        return stem;
    }
    return "Untitled";
}

std::string to_lower_string(std::string_view s) {
    std::string res;
    res.reserve(s.size());
    for (char c : s) {
        res.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }
    return res;
}

size_t levenshtein_distance(std::string_view s1, std::string_view s2) {
    const size_t m = s1.size();
    const size_t n = s2.size();
    if (m == 0) return n;
    if (n == 0) return m;

    std::vector<size_t> dp0(n + 1);
    std::vector<size_t> dp1(n + 1);

    for (size_t j = 0; j <= n; ++j) dp0[j] = j;

    for (size_t i = 1; i <= m; ++i) {
        dp1[0] = i;
        for (size_t j = 1; j <= n; ++j) {
            char c1 = static_cast<char>(std::tolower(static_cast<unsigned char>(s1[i - 1])));
            char c2 = static_cast<char>(std::tolower(static_cast<unsigned char>(s2[j - 1])));
            size_t cost = (c1 == c2) ? 0 : 1;
            dp1[j] = std::min({ dp0[j] + 1, dp1[j - 1] + 1, dp0[j - 1] + cost });
        }
        dp0 = dp1;
    }
    return dp0[n];
}

} // namespace

DocumentService::DocumentService(
    std::shared_ptr<db::ConnectionPool> db_pool,
    std::shared_ptr<storage::PosixStorageBackend> storage
) : db_pool_(std::move(db_pool)),
    storage_(std::move(storage)) {}

Result<db::AccessLevel> DocumentService::check_access(
    const auth::UserIdentity& user,
    const std::string& document_id,
    const std::string& fs_path
) {
    if (user.is_system_admin) {
        return db::AccessLevel::Admin;
    }

    if (!db_pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    return db::PermissionEngine::check_permission(
        conn_res->get(),
        user.user_id,
        document_id,
        fs_path
    );
}

Result<DocumentRecord> DocumentService::create_document(
    const CreateDocumentRequest& req,
    const auth::UserIdentity& user
) {
    if (!storage_ || !db_pool_) {
        return std::unexpected(ErrorCode::IoError);
    }

    std::string norm_path = normalize_rel_path(req.path);
    if (norm_path.empty() || has_path_traversal(norm_path)) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    bool is_bundle = req.is_bundle || norm_path.ends_with(".bundle");
    if (!is_bundle && !norm_path.ends_with(".md")) {
        norm_path += ".md";
    }

    // Check directory permission
    std::filesystem::path fp(norm_path);
    std::string parent_dir = fp.parent_path().string();
    auto access_res = check_access(user, "", parent_dir);
    if (!access_res.has_value()) {
        return std::unexpected(access_res.error());
    }
    if (access_res.value() < db::AccessLevel::Edit && !parent_dir.empty()) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    // Check if document already exists in storage
    auto exists_res = storage_->exists(norm_path);
    if (exists_res.has_value() && exists_res.value()) {
        return std::unexpected(ErrorCode::AlreadyExists);
    }

    // Determine title
    std::string title = req.title.empty() ? derive_title(req.content, norm_path) : req.title;

    // Write file to storage
    std::string content_file = is_bundle ? (norm_path + "/index.md") : norm_path;
    auto write_res = storage_->write_file(content_file, req.content, true);
    if (!write_res.has_value()) {
        return std::unexpected(write_res.error());
    }

    if (is_bundle) {
        auto dir_res = storage_->create_directory(norm_path + "/images");
        (void)dir_res;
    }

    // Insert metadata into PostgreSQL
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    try {
        pqxx::work tx(conn_res->get());

        std::string owner_id = user.user_id;
        std::string owner_team_id = "";
        if (!parent_dir.empty()) {
            auto p_rows = tx.exec_params(
                "SELECT owner_user_id::text, owner_team_id::text FROM directory_metadata WHERE directory_path = $1",
                parent_dir
            );
            if (!p_rows.empty()) {
                if (!p_rows[0][0].is_null()) owner_id = p_rows[0][0].as<std::string>();
                if (!p_rows[0][1].is_null()) owner_team_id = p_rows[0][1].as<std::string>();
            }
        }

        std::string query =
            "INSERT INTO documents (fs_path, title, owner_user_id, owner_team_id) "
            "VALUES ($1, $2, NULLIF($3, '')::uuid, NULLIF($4, '')::uuid) "
            "RETURNING id, fs_path, title, COALESCE(owner_user_id::text, ''), "
            "          TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
            "          TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"');";

        auto row = tx.exec_params(query, norm_path, title, owner_id, owner_team_id);
        if (row.empty()) {
            return std::unexpected(ErrorCode::DatabaseError);
        }

        DocumentRecord doc{
            .id = row[0][0].as<std::string>(),
            .path = row[0][1].as<std::string>(),
            .title = row[0][2].as<std::string>(),
            .content = req.content,
            .is_bundle = is_bundle,
            .owner_user_id = row[0][3].as<std::string>(),
            .created_at = row[0][4].as<std::string>(),
            .updated_at = row[0][5].as<std::string>()
        };

        tx.commit();
        return doc;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] create_document DB insert failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<std::string> DocumentService::create_directory(
    const std::string& relative_path,
    const auth::UserIdentity& user
) {
    if (!storage_ || !db_pool_) {
        return std::unexpected(ErrorCode::IoError);
    }

    std::string norm_path = normalize_rel_path(relative_path);
    if (norm_path.empty() || has_path_traversal(norm_path)) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    std::filesystem::path fp(norm_path);
    std::string parent_dir = fp.parent_path().string();
    auto access_res = check_access(user, "", parent_dir);
    if (!access_res.has_value()) {
        return std::unexpected(access_res.error());
    }
    if (access_res.value() < db::AccessLevel::Edit && !parent_dir.empty()) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    auto dir_res = storage_->create_directory(norm_path);
    if (!dir_res.has_value()) {
        return std::unexpected(dir_res.error());
    }

    auto conn_res = db_pool_->acquire();
    if (conn_res.has_value()) {
        try {
            pqxx::work tx(conn_res->get());
            std::string owner_id = user.user_id;
            std::string owner_team_id = "";
            if (!parent_dir.empty()) {
                auto p_rows = tx.exec_params(
                    "SELECT owner_user_id::text, owner_team_id::text FROM directory_metadata WHERE directory_path = $1",
                    parent_dir
                );
                if (!p_rows.empty()) {
                    if (!p_rows[0][0].is_null()) owner_id = p_rows[0][0].as<std::string>();
                    if (!p_rows[0][1].is_null()) owner_team_id = p_rows[0][1].as<std::string>();
                }
            }
            tx.exec_params(
                R"(
                INSERT INTO directory_metadata (directory_path, owner_user_id, owner_team_id)
                VALUES ($1, NULLIF($2, '')::uuid, NULLIF($3, '')::uuid)
                ON CONFLICT (directory_path) DO UPDATE SET updated_at = NOW();
                )",
                norm_path,
                owner_id,
                owner_team_id
            );
            tx.commit();
        } catch (const std::exception& e) {
            std::cerr << "[WARN] Failed to record directory_metadata: " << e.what() << "\n";
        }
    }

    return norm_path;
}

Result<DocumentRecord> DocumentService::get_document_by_id(
    const std::string& doc_id,
    const auth::UserIdentity& user
) {
    if (!storage_ || !db_pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    if (!is_valid_uuid(doc_id)) {
        // If not a canonical UUID, fallback to resolution by filesystem path
        return get_document_by_path(doc_id, user);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    try {
        pqxx::read_transaction tx(conn_res->get());

        std::string query =
            "SELECT id, fs_path, title, COALESCE(owner_user_id::text, ''), "
            "       TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
            "       TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
            "FROM documents WHERE id = $1::uuid;";

        auto rows = tx.exec_params(query, doc_id);
        if (rows.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }

        auto r = rows[0];
        std::string fs_path = r[1].as<std::string>();

        // Check permission
        auto access_res = check_access(user, doc_id, fs_path);
        if (!access_res.has_value()) {
            return std::unexpected(access_res.error());
        }
        if (access_res.value() < db::AccessLevel::Read) {
            return std::unexpected(ErrorCode::PermissionDenied);
        }

        bool is_bundle = storage_->is_bundle(fs_path).value_or(false);
        std::string content_path = is_bundle ? (fs_path + "/index.md") : fs_path;

        auto read_res = storage_->read_file(content_path);
        std::string content = read_res.has_value() ? read_res.value() : "";

        return DocumentRecord{
            .id = r[0].as<std::string>(),
            .path = fs_path,
            .title = r[2].as<std::string>(),
            .content = std::move(content),
            .is_bundle = is_bundle,
            .owner_user_id = r[3].as<std::string>(),
            .created_at = r[4].as<std::string>(),
            .updated_at = r[5].as<std::string>()
        };
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] get_document_by_id failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<DocumentRecord> DocumentService::get_document_by_path(
    const std::string& relative_path,
    const auth::UserIdentity& user
) {
    if (!storage_ || !db_pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    // Strip anchor if present (e.g., "target#heading")
    std::string clean_path = relative_path;
    auto hash_idx = clean_path.find('#');
    if (hash_idx != std::string::npos) {
        clean_path = clean_path.substr(0, hash_idx);
    }
    std::string norm_path = normalize_rel_path(clean_path);
    if (norm_path.empty() || has_path_traversal(norm_path)) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    std::filesystem::path fp(norm_path);
    std::string basename = fp.filename().string();
    std::string stem = fp.stem().string();

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    try {
        pqxx::work tx(conn_res->get());

        // 1. Exact fs_path match
        auto rows = tx.exec_params(
            "SELECT id, fs_path, title, COALESCE(owner_user_id::text, ''), "
            "       TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
            "       TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
            "FROM documents WHERE fs_path = $1;",
            norm_path
        );

        // 2. Exact fs_path with .md extension if not already ending with .md
        if (rows.empty() && !norm_path.ends_with(".md") && !norm_path.ends_with(".bundle")) {
            rows = tx.exec_params(
                "SELECT id, fs_path, title, COALESCE(owner_user_id::text, ''), "
                "       TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
                "       TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
                "FROM documents WHERE fs_path = $1;",
                norm_path + ".md"
            );
        }

        // 3. Exact title match (norm_path or stem)
        if (rows.empty()) {
            rows = tx.exec_params(
                "SELECT id, fs_path, title, COALESCE(owner_user_id::text, ''), "
                "       TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
                "       TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
                "FROM documents WHERE title = $1 OR title = $2 LIMIT 1;",
                norm_path,
                stem
            );
        }

        // 4. Vault-wide basename match (e.g. [[Test File Modified]] matches specs/Test File Modified.md)
        if (rows.empty()) {
            rows = tx.exec_params(
                "SELECT id, fs_path, title, COALESCE(owner_user_id::text, ''), "
                "       TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
                "       TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
                "FROM documents "
                "WHERE fs_path = $1 "
                "   OR fs_path = $1 || '.md' "
                "   OR fs_path LIKE '%/' || $1 "
                "   OR fs_path LIKE '%/' || $1 || '.md' "
                "   OR fs_path = $2 "
                "   OR fs_path = $2 || '.md' "
                "   OR fs_path LIKE '%/' || $2 "
                "   OR fs_path LIKE '%/' || $2 || '.md' "
                "LIMIT 1;",
                basename,
                stem
            );
        }

        // 5. Case-insensitive match on fs_path, basename, or title (ILIKE)
        if (rows.empty()) {
            rows = tx.exec_params(
                "SELECT id, fs_path, title, COALESCE(owner_user_id::text, ''), "
                "       TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
                "       TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
                "FROM documents "
                "WHERE fs_path ILIKE $1 "
                "   OR fs_path ILIKE $1 || '.md' "
                "   OR fs_path ILIKE '%/' || $1 "
                "   OR fs_path ILIKE '%/' || $1 || '.md' "
                "   OR fs_path ILIKE $2 "
                "   OR fs_path ILIKE $2 || '.md' "
                "   OR fs_path ILIKE '%/' || $2 "
                "   OR fs_path ILIKE '%/' || $2 || '.md' "
                "   OR title ILIKE $1 "
                "   OR title ILIKE $2 "
                "LIMIT 1;",
                basename,
                stem
            );
        }

        // 6. Typo-tolerant / fuzzy match across all existing documents (Levenshtein distance <= 2 or 3)
        if (rows.empty()) {
            auto all_docs = tx.exec(
                "SELECT id, fs_path, title, COALESCE(owner_user_id::text, ''), "
                "       TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
                "       TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
                "FROM documents;"
            );

            size_t best_dist = std::numeric_limits<size_t>::max();
            std::string best_id;

            std::string needle1 = to_lower_string(stem);
            std::string needle2 = to_lower_string(norm_path);

            for (const auto& r : all_docs) {
                std::string doc_title = to_lower_string(r[2].as<std::string>());
                std::string doc_path = to_lower_string(r[1].as<std::string>());
                std::filesystem::path dfp(doc_path);
                std::string doc_stem = to_lower_string(dfp.stem().string());

                size_t d1 = levenshtein_distance(needle1, doc_stem);
                size_t d2 = levenshtein_distance(needle1, doc_title);
                size_t d3 = levenshtein_distance(needle2, doc_path);
                size_t min_d = std::min({d1, d2, d3});

                size_t max_allowed = (needle1.size() >= 10 || needle2.size() >= 10) ? 3 : 2;
                if (min_d <= max_allowed && min_d < best_dist) {
                    best_dist = min_d;
                    best_id = r[0].as<std::string>();
                }
            }

            if (!best_id.empty()) {
                rows = tx.exec_params(
                    "SELECT id, fs_path, title, COALESCE(owner_user_id::text, ''), "
                    "       TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
                    "       TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
                    "FROM documents WHERE id = $1::uuid;",
                    best_id
                );
            }
        }

        std::string doc_id;
        std::string actual_fs_path;
        std::string title;
        std::string owner_user_id;
        std::string created_at;
        std::string updated_at;

        if (rows.empty()) {
            // Check storage on disk (Auto-reconciliation)
            std::string disk_target_path = norm_path;
            auto disk_exists = storage_->exists(disk_target_path);
            if (!disk_exists.value_or(false)) {
                if (!disk_target_path.ends_with(".md") && storage_->exists(disk_target_path + ".md").value_or(false)) {
                    disk_target_path += ".md";
                } else {
                    auto list_res = storage_->list_directory("", true);
                    if (list_res.has_value()) {
                        for (const auto& node : list_res.value()) {
                            if (node.is_directory && !node.is_bundle) continue;
                            std::filesystem::path np(node.relative_path);
                            if (np.filename().string() == basename ||
                                np.stem().string() == stem ||
                                to_lower_string(np.stem().string()) == to_lower_string(stem)) {
                                disk_target_path = node.relative_path;
                                break;
                            }
                        }
                    }
                }
            }

            if (!storage_->exists(disk_target_path).value_or(false)) {
                return std::unexpected(ErrorCode::NotFound);
            }

            actual_fs_path = disk_target_path;
            bool is_bundle = storage_->is_bundle(actual_fs_path).value_or(false);
            std::string content_file = is_bundle ? (actual_fs_path + "/index.md") : actual_fs_path;
            auto content_res = storage_->read_file(content_file);
            std::string disk_content = content_res.has_value() ? content_res.value() : "";

            title = derive_title(disk_content, actual_fs_path);

            auto ins_rows = tx.exec_params(
                "INSERT INTO documents (fs_path, title, owner_user_id) "
                "VALUES ($1, $2, NULLIF($3, '')::uuid) "
                "ON CONFLICT (fs_path) DO UPDATE SET updated_at = NOW() "
                "RETURNING id, TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
                "          TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"');",
                actual_fs_path,
                title,
                user.user_id
            );
            doc_id = ins_rows[0][0].as<std::string>();
            created_at = ins_rows[0][1].as<std::string>();
            updated_at = ins_rows[0][2].as<std::string>();
            owner_user_id = user.user_id;
        } else {
            auto r = rows[0];
            doc_id = r[0].as<std::string>();
            actual_fs_path = r[1].as<std::string>();
            title = r[2].as<std::string>();
            owner_user_id = r[3].as<std::string>();
            created_at = r[4].as<std::string>();
            updated_at = r[5].as<std::string>();
        }

        tx.commit();

        // Check permission
        auto access_res = check_access(user, doc_id, actual_fs_path);
        if (!access_res.has_value()) {
            return std::unexpected(access_res.error());
        }
        if (access_res.value() < db::AccessLevel::Read) {
            return std::unexpected(ErrorCode::PermissionDenied);
        }

        bool is_bundle = storage_->is_bundle(actual_fs_path).value_or(false);
        std::string content_file = is_bundle ? (actual_fs_path + "/index.md") : actual_fs_path;
        auto read_res = storage_->read_file(content_file);
        std::string content = read_res.has_value() ? read_res.value() : "";

        return DocumentRecord{
            .id = doc_id,
            .path = actual_fs_path,
            .title = title,
            .content = std::move(content),
            .is_bundle = is_bundle,
            .owner_user_id = owner_user_id,
            .created_at = created_at,
            .updated_at = updated_at
        };
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] get_document_by_path failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<std::string> DocumentService::get_document_raw(
    const std::string& doc_id,
    const auth::UserIdentity& user
) {
    auto doc_res = get_document_by_id(doc_id, user);
    if (!doc_res.has_value()) {
        return std::unexpected(doc_res.error());
    }
    return doc_res.value().content;
}

Result<DocumentRecord> DocumentService::update_document(
    const std::string& doc_id,
    const std::string& content,
    std::optional<std::string> title,
    const auth::UserIdentity& user
) {
    if (!storage_ || !db_pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    try {
        pqxx::work tx(conn_res->get());

        auto rows = tx.exec_params(
            "SELECT id, fs_path, title, COALESCE(owner_user_id::text, '') "
            "FROM documents WHERE id = $1::uuid;",
            doc_id
        );
        if (rows.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }

        auto r = rows[0];
        std::string fs_path = r[1].as<std::string>();
        std::string current_title = r[2].as<std::string>();
        std::string owner_id = r[3].as<std::string>();

        // Check permission
        auto access_res = check_access(user, doc_id, fs_path);
        if (!access_res.has_value()) {
            return std::unexpected(access_res.error());
        }
        if (access_res.value() < db::AccessLevel::Edit) {
            return std::unexpected(ErrorCode::PermissionDenied);
        }

        // Write content to storage
        bool is_bundle = storage_->is_bundle(fs_path).value_or(false);
        std::string content_file = is_bundle ? (fs_path + "/index.md") : fs_path;
        auto write_res = storage_->write_file(content_file, content, true);
        if (!write_res.has_value()) {
            return std::unexpected(write_res.error());
        }

        // Update title if specified
        std::string new_title = title.value_or(current_title);
        auto up_rows = tx.exec_params(
            "UPDATE documents SET title = $2, updated_at = NOW() WHERE id = $1::uuid "
            "RETURNING TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
            "          TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"');",
            doc_id,
            new_title
        );

        std::string created_at = up_rows[0][0].as<std::string>();
        std::string updated_at = up_rows[0][1].as<std::string>();
        tx.commit();

        return DocumentRecord{
            .id = doc_id,
            .path = fs_path,
            .title = new_title,
            .content = content,
            .is_bundle = is_bundle,
            .owner_user_id = owner_id,
            .created_at = created_at,
            .updated_at = updated_at
        };
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] update_document failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<DocumentRecord> DocumentService::move_document(
    const std::string& doc_id,
    const std::string& new_path,
    const auth::UserIdentity& user,
    std::optional<std::string> new_title
) {
    if (!storage_ || !db_pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    std::string norm_new_path = normalize_rel_path(new_path);
    if (norm_new_path.empty() || has_path_traversal(norm_new_path)) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    try {
        pqxx::work tx(conn_res->get());

        auto rows = tx.exec_params(
            "SELECT id, fs_path, title, COALESCE(owner_user_id::text, '') "
            "FROM documents WHERE id = $1::uuid;",
            doc_id
        );
        if (rows.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }

        auto r = rows[0];
        std::string old_fs_path = r[1].as<std::string>();
        std::string title = r[2].as<std::string>();
        std::string owner_id = r[3].as<std::string>();

        // Check permission on old document
        auto access_old = check_access(user, doc_id, old_fs_path);
        if (!access_old.has_value() || access_old.value() < db::AccessLevel::Edit) {
            return std::unexpected(ErrorCode::PermissionDenied);
        }

        // Check permission on destination directory
        std::filesystem::path fp(norm_new_path);
        std::string dest_dir = fp.parent_path().string();
        auto access_new = check_access(user, "", dest_dir);
        if (!access_new.has_value() || access_new.value() < db::AccessLevel::Edit) {
            if (!dest_dir.empty()) {
                return std::unexpected(ErrorCode::PermissionDenied);
            }
        }

        // Move in storage
        auto move_res = storage_->move_node(old_fs_path, norm_new_path);
        if (!move_res.has_value()) {
            return std::unexpected(move_res.error());
        }

        // Determine updated title
        std::string target_title = new_title.value_or("");
        if (target_title.empty()) {
            std::filesystem::path old_fp(old_fs_path);
            std::filesystem::path new_fp(norm_new_path);
            if (old_fp.filename() != new_fp.filename()) {
                target_title = derive_title("", norm_new_path);
            } else {
                target_title = title;
            }
        }

        // Update database record
        auto up_rows = tx.exec_params(
            "UPDATE documents SET fs_path = $2, title = $3, updated_at = NOW() WHERE id = $1::uuid "
            "RETURNING TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
            "          TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"');",
            doc_id,
            norm_new_path,
            target_title
        );

        std::string created_at = up_rows[0][0].as<std::string>();
        std::string updated_at = up_rows[0][1].as<std::string>();
        tx.commit();

        bool is_bundle = storage_->is_bundle(norm_new_path).value_or(false);

        return DocumentRecord{
            .id = doc_id,
            .path = norm_new_path,
            .title = target_title,
            .content = "",
            .is_bundle = is_bundle,
            .owner_user_id = owner_id,
            .created_at = created_at,
            .updated_at = updated_at
        };
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] move_document failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<std::string> DocumentService::delete_document(
    const std::string& doc_id,
    const auth::UserIdentity& user
) {
    if (!storage_ || !db_pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    try {
        pqxx::work tx(conn_res->get());

        auto rows = tx.exec_params(
            "SELECT id, fs_path FROM documents WHERE id = $1::uuid;",
            doc_id
        );
        if (rows.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }

        std::string fs_path = rows[0][1].as<std::string>();

        // Check permission
        auto access_res = check_access(user, doc_id, fs_path);
        if (!access_res.has_value() || access_res.value() < db::AccessLevel::Edit) {
            return std::unexpected(ErrorCode::PermissionDenied);
        }

        // Soft-delete to trash in storage
        auto trash_res = storage_->delete_to_trash(fs_path);
        if (!trash_res.has_value()) {
            return std::unexpected(trash_res.error());
        }

        // Clean up persisted CRDT state
        storage_->delete_crdt_state(doc_id);

        // Delete database record (cascades to permissions, comments, tasks)
        tx.exec_params("DELETE FROM documents WHERE id = $1::uuid;", doc_id);
        tx.commit();

        return trash_res.value();
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] delete_document failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<std::string> DocumentService::upload_asset(
    const std::string& doc_id,
    const std::string& filename,
    std::string_view data,
    const auth::UserIdentity& user
) {
    if (!storage_ || !db_pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    std::string clean_fn = normalize_rel_path(filename);
    if (clean_fn.empty() || has_path_traversal(clean_fn)) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    try {
        pqxx::read_transaction tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT fs_path FROM documents WHERE id = $1::uuid;",
            doc_id
        );
        if (rows.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }

        std::string fs_path = rows[0][0].as<std::string>();

        // Check permission
        auto access_res = check_access(user, doc_id, fs_path);
        if (!access_res.has_value() || access_res.value() < db::AccessLevel::Edit) {
            return std::unexpected(ErrorCode::PermissionDenied);
        }

        bool is_bundle = storage_->is_bundle(fs_path).value_or(false);
        std::string asset_path;
        if (is_bundle) {
            asset_path = fs_path + "/images/" + clean_fn;
        } else {
            std::filesystem::path fp(fs_path);
            std::string parent = fp.parent_path().string();
            asset_path = (parent.empty() ? "" : parent + "/") + "images/" + clean_fn;
        }

        auto write_res = storage_->write_file(asset_path, data, true);
        if (!write_res.has_value()) {
            return std::unexpected(write_res.error());
        }

        return asset_path;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] upload_asset failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<std::string> DocumentService::read_asset(
    const std::string& doc_id,
    const std::string& filename,
    const auth::UserIdentity& user
) {
    if (!storage_ || !db_pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    std::string clean_fn = normalize_rel_path(filename);
    if (clean_fn.empty() || has_path_traversal(clean_fn)) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    try {
        pqxx::read_transaction tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT fs_path FROM documents WHERE id = $1::uuid;",
            doc_id
        );
        if (rows.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }

        std::string fs_path = rows[0][0].as<std::string>();

        // Check permission
        auto access_res = check_access(user, doc_id, fs_path);
        if (!access_res.has_value() || access_res.value() < db::AccessLevel::Read) {
            return std::unexpected(ErrorCode::PermissionDenied);
        }

        bool is_bundle = storage_->is_bundle(fs_path).value_or(false);
        std::string asset_path;
        if (is_bundle) {
            asset_path = fs_path + "/images/" + clean_fn;
        } else {
            std::filesystem::path fp(fs_path);
            std::string parent = fp.parent_path().string();
            asset_path = (parent.empty() ? "" : parent + "/") + "images/" + clean_fn;
        }

        return storage_->read_file(asset_path);
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] read_asset failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<DocumentRecord> DocumentService::upload_workspace_file(
    const std::string& relative_path,
    std::string_view data,
    const auth::UserIdentity& user
) {
    if (!storage_ || !db_pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    std::string clean_path = normalize_rel_path(relative_path);
    if (clean_path.empty() || has_path_traversal(clean_path)) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    // Check permission on path or parent directory
    std::filesystem::path fp(clean_path);
    std::string parent_dir = fp.parent_path().string();
    auto access_res = check_access(user, "", parent_dir);
    if (!access_res.has_value() || access_res.value() < db::AccessLevel::Edit) {
        if (!parent_dir.empty()) {
            return std::unexpected(ErrorCode::PermissionDenied);
        }
    }

    auto write_res = storage_->write_file(clean_path, data, true);
    if (!write_res.has_value()) {
        return std::unexpected(write_res.error());
    }

    std::string lower_path = to_lower_string(clean_path);
    bool is_md = lower_path.ends_with(".md") || lower_path.ends_with(".markdown");
    std::string title = is_md ? derive_title(data, clean_path) : fp.filename().string();

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "INSERT INTO documents (fs_path, title, owner_user_id) "
            "VALUES ($1, $2, NULLIF($3, '')::uuid) "
            "ON CONFLICT (fs_path) DO UPDATE "
            "SET title = EXCLUDED.title, updated_at = NOW() "
            "RETURNING id, COALESCE(owner_user_id::text, ''), "
            "          TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
            "          TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"');",
            clean_path,
            title,
            user.user_id
        );
        tx.commit();

        if (rows.empty()) {
            return std::unexpected(ErrorCode::DatabaseError);
        }

        return DocumentRecord{
            .id = rows[0][0].as<std::string>(),
            .path = clean_path,
            .title = title,
            .content = is_md ? std::string(data) : "",
            .is_bundle = false,
            .owner_user_id = rows[0][1].as<std::string>(),
            .created_at = rows[0][2].as<std::string>(),
            .updated_at = rows[0][3].as<std::string>()
        };
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] upload_workspace_file DB upsert failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<std::string> DocumentService::read_workspace_file(
    const std::string& relative_path,
    const auth::UserIdentity& user
) {
    if (!storage_ || !db_pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    std::string clean_path = normalize_rel_path(relative_path);
    if (clean_path.empty() || has_path_traversal(clean_path)) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    std::string doc_id;
    auto conn_res = db_pool_->acquire();
    if (conn_res.has_value()) {
        try {
            pqxx::read_transaction tx(conn_res->get());
            auto rows = tx.exec_params(
                "SELECT id FROM documents WHERE fs_path = $1;",
                clean_path
            );
            if (!rows.empty()) {
                doc_id = rows[0][0].as<std::string>();
            }
        } catch (...) {}
    }

    auto direct_res = storage_->read_file(clean_path);
    if (direct_res.has_value()) {
        auto access_res = check_access(user, doc_id, clean_path);
        if (!access_res.has_value() || access_res.value() < db::AccessLevel::Read) {
            return std::unexpected(ErrorCode::PermissionDenied);
        }
        return direct_res;
    }

    // Basename fallback: if file was not found directly at clean_path, search workspace for matching basename
    std::filesystem::path p(clean_path);
    std::string filename = p.filename().string();
    if (!filename.empty()) {
        auto list_res = storage_->list_directory("", true);
        if (list_res.has_value()) {
            for (const auto& node : list_res.value()) {
                if (!node.is_directory && node.name == filename) {
                    std::string matched_doc_id;
                    if (conn_res.has_value()) {
                        try {
                            pqxx::read_transaction tx(conn_res->get());
                            auto rows = tx.exec_params(
                                "SELECT id FROM documents WHERE fs_path = $1;",
                                node.relative_path
                            );
                            if (!rows.empty()) {
                                matched_doc_id = rows[0][0].as<std::string>();
                            }
                        } catch (...) {}
                    }
                    auto matched_access = check_access(user, matched_doc_id, node.relative_path);
                    if (matched_access.has_value() && matched_access.value() >= db::AccessLevel::Read) {
                        return storage_->read_file(node.relative_path);
                    }
                }
            }
        }
    }

    auto access_res = check_access(user, doc_id, clean_path);
    if (!access_res.has_value() || access_res.value() < db::AccessLevel::Read) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    return direct_res;
}

Result<nlohmann::json> DocumentService::get_workspace_tree(const auth::UserIdentity& user) {
    if (!storage_ || !db_pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    struct DocMeta {
        std::string id;
        std::string title;
        std::string owner_id;
        std::string updated_at;
    };

    std::map<std::string, DocMeta> indexed_docs;

    // List storage nodes recursively
    auto list_res = storage_->list_directory("", true);
    if (!list_res.has_value()) {
        return std::unexpected(list_res.error());
    }

    {
        auto conn_res = db_pool_->acquire();
        if (!conn_res.has_value()) {
            return std::unexpected(conn_res.error());
        }

        try {
            pqxx::read_transaction tx(conn_res->get());
            auto rows = tx.exec(
                "SELECT id, fs_path, title, COALESCE(owner_user_id::text, ''), "
                "       TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
                "FROM documents;"
            );
            for (const auto& r : rows) {
                indexed_docs[r[1].as<std::string>()] = DocMeta{
                    .id = r[0].as<std::string>(),
                    .title = r[2].as<std::string>(),
                    .owner_id = r[3].as<std::string>(),
                    .updated_at = r[4].as<std::string>()
                };
            }
        } catch (const std::exception& e) {
            std::cerr << "[ERROR] get_workspace_tree DB fetch failed: " << e.what() << "\n";
        }

        // Auto-reconcile unindexed documents & files found on disk
        std::vector<std::string> unindexed_paths;
        for (const auto& node : list_res.value()) {
            if (!node.is_directory || node.is_bundle) {
                if (node.relative_path.find(".bundle/") == std::string::npos &&
                    !indexed_docs.contains(node.relative_path)) {
                    unindexed_paths.push_back(node.relative_path);
                }
            }
        }

        if (!unindexed_paths.empty()) {
            try {
                pqxx::work wtx(conn_res->get());
                for (const auto& path : unindexed_paths) {
                    bool is_bundle = storage_->is_bundle(path).value_or(false);
                    std::string lower_path = to_lower_string(path);
                    bool is_md = is_bundle || lower_path.ends_with(".md") || lower_path.ends_with(".markdown");
                    std::string title;
                    if (is_md) {
                        std::string content_file = is_bundle ? (path + "/index.md") : path;
                        auto content_res = storage_->read_file(content_file);
                        std::string disk_content = content_res.has_value() ? content_res.value() : "";
                        title = derive_title(disk_content, path);
                    } else {
                        title = std::filesystem::path(path).filename().string();
                    }

                    auto ins_rows = wtx.exec_params(
                        "INSERT INTO documents (fs_path, title, owner_user_id) "
                        "VALUES ($1, $2, NULLIF($3, '')::uuid) "
                        "ON CONFLICT (fs_path) DO UPDATE SET updated_at = NOW() "
                        "RETURNING id, TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"');",
                        path,
                        title,
                        user.user_id
                    );
                    if (!ins_rows.empty()) {
                        indexed_docs[path] = DocMeta{
                            .id = ins_rows[0][0].as<std::string>(),
                            .title = title,
                            .owner_id = user.user_id,
                            .updated_at = ins_rows[0][1].as<std::string>()
                        };
                    }
                }
                wtx.commit();
            } catch (const std::exception& e) {
                std::cerr << "[WARN] Auto-reconciliation in get_workspace_tree failed: " << e.what() << "\n";
            }
        }
    }

    nlohmann::json items = nlohmann::json::array();
    for (const auto& node : list_res.value()) {
        // Skip internal files/folders inside .bundle directories in tree listing
        if (node.relative_path.find(".bundle/") != std::string::npos) {
            continue;
        }

        // Check read permission
        std::string doc_id = indexed_docs.contains(node.relative_path) ? indexed_docs[node.relative_path].id : "";
        auto access_res = check_access(user, doc_id, node.relative_path);
        if (access_res.has_value() && access_res.value() < db::AccessLevel::Read) {
            continue; // Exclude node user is not permitted to see
        }

        nlohmann::json item;
        item["name"] = node.name;
        item["path"] = node.relative_path;
        item["is_directory"] = node.is_directory;
        item["is_bundle"] = node.is_bundle;
        item["size_bytes"] = node.size_bytes;

        if (indexed_docs.contains(node.relative_path)) {
            const auto& meta = indexed_docs[node.relative_path];
            item["id"] = meta.id;
            item["title"] = meta.title;
            item["owner_user_id"] = meta.owner_id;
            item["updated_at"] = meta.updated_at;
        } else if (!node.is_directory || node.is_bundle) {
            std::string lower_path = to_lower_string(node.relative_path);
            bool is_md = node.is_bundle || lower_path.ends_with(".md") || lower_path.ends_with(".markdown");
            item["title"] = is_md ? derive_title("", node.relative_path) : node.name;
        }

        items.push_back(std::move(item));
    }

    return items;
}

Result<renderer::ReviewBundle> DocumentService::get_document_reviews(
    const std::string& doc_id,
    const auth::UserIdentity& user
) {
    if (!db_pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    try {
        pqxx::read_transaction tx(conn_res->get());

        // Check if doc exists and retrieve fs_path
        auto rows = tx.exec_params(
            "SELECT fs_path FROM documents WHERE id = $1::uuid;",
            doc_id
        );
        if (rows.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }
        std::string fs_path = rows[0][0].as<std::string>();

        auto access_res = check_access(user, doc_id, fs_path);
        if (!access_res.has_value()) {
            return std::unexpected(access_res.error());
        }
        if (access_res.value() < db::AccessLevel::Read) {
            return std::unexpected(ErrorCode::PermissionDenied);
        }

        renderer::ReviewBundle bundle;

        // Fetch comments
        auto comment_rows = tx.exec_params(
            "SELECT c.id::text, c.content, c.status, "
            "       TO_CHAR(c.created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
            "       u.username, u.display_name "
            "FROM comments c "
            "JOIN users u ON c.author_id = u.id "
            "WHERE c.document_id = $1::uuid "
            "ORDER BY c.created_at ASC;",
            doc_id
        );
        for (const auto& r : comment_rows) {
            bundle.comments.push_back({
                .id = r[0].as<std::string>(),
                .author_username = r[4].as<std::string>(),
                .author_display_name = r[5].as<std::string>(),
                .content = r[1].as<std::string>(),
                .status = r[2].as<std::string>(),
                .created_at = r[3].as<std::string>()
            });
        }

        // Fetch suggestions
        auto suggestion_rows = tx.exec_params(
            "SELECT s.id::text, s.original_text, s.suggested_text, s.status, "
            "       TO_CHAR(s.created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
            "       u.username, u.display_name "
            "FROM suggestions s "
            "JOIN users u ON s.author_id = u.id "
            "WHERE s.document_id = $1::uuid "
            "ORDER BY s.created_at ASC;",
            doc_id
        );
        for (const auto& r : suggestion_rows) {
            bundle.suggestions.push_back({
                .id = r[0].as<std::string>(),
                .author_username = r[5].as<std::string>(),
                .author_display_name = r[6].as<std::string>(),
                .original_text = r[1].as<std::string>(),
                .suggested_text = r[2].as<std::string>(),
                .status = r[3].as<std::string>(),
                .created_at = r[4].as<std::string>()
            });
        }

        // Fetch tasks
        auto task_rows = tx.exec_params(
            "SELECT t.id::text, t.description, t.is_completed, "
            "       TO_CHAR(t.created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
            "       COALESCE(u.username, ''), COALESCE(u.display_name, '') "
            "FROM tasks t "
            "LEFT JOIN users u ON t.assignee_id = u.id "
            "WHERE t.document_id = $1::uuid "
            "ORDER BY t.created_at ASC;",
            doc_id
        );
        for (const auto& r : task_rows) {
            bundle.tasks.push_back({
                .id = r[0].as<std::string>(),
                .description = r[1].as<std::string>(),
                .is_completed = r[2].as<bool>(),
                .assignee_username = r[4].as<std::string>(),
                .assignee_display_name = r[5].as<std::string>(),
                .created_at = r[3].as<std::string>()
            });
        }

        return bundle;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] get_document_reviews failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<nlohmann::json> DocumentService::get_recent_documents(
    const auth::UserIdentity& user,
    size_t limit
) {
    if (!db_pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    try {
        pqxx::read_transaction tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT id, fs_path, title, COALESCE(owner_user_id::text, ''), "
            "       TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
            "       TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
            "FROM documents "
            "ORDER BY updated_at DESC "
            "LIMIT $1;",
            std::max(static_cast<size_t>(1), std::min(limit * 2, static_cast<size_t>(100)))
        );

        nlohmann::json results = nlohmann::json::array();
        for (const auto& r : rows) {
            std::string doc_id = r[0].as<std::string>();
            std::string fs_path = r[1].as<std::string>();
            auto access = check_access(user, doc_id, fs_path);
            if (access.has_value() && access.value() >= db::AccessLevel::Read) {
                bool is_bundle = storage_ ? storage_->is_bundle(fs_path).value_or(false) : false;
                results.push_back({
                    {"id", doc_id},
                    {"path", fs_path},
                    {"title", r[2].as<std::string>()},
                    {"owner_user_id", r[3].as<std::string>()},
                    {"created_at", r[4].as<std::string>()},
                    {"updated_at", r[5].as<std::string>()},
                    {"is_bundle", is_bundle}
                });
                if (results.size() >= limit) {
                    break;
                }
            }
        }
        return results;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] get_recent_documents failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<nlohmann::json> DocumentService::search_documents(
    const std::string& query,
    const std::string& path_prefix,
    size_t limit,
    const auth::UserIdentity& user
) {
    if (!db_pool_ || !storage_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    if (query.empty()) {
        return nlohmann::json::array();
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    auto to_lower = [](std::string s) {
        for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        return s;
    };
    std::string lq = to_lower(query);

    try {
        pqxx::read_transaction tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT id, fs_path, title, "
            "       TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
            "FROM documents "
            "WHERE ($1 = '' OR fs_path LIKE $1 || '%') "
            "ORDER BY updated_at DESC;",
            path_prefix
        );

        nlohmann::json results = nlohmann::json::array();
        for (const auto& r : rows) {
            std::string doc_id = r[0].as<std::string>();
            std::string fs_path = r[1].as<std::string>();
            std::string title = r[2].as<std::string>();
            std::string updated_at = r[3].as<std::string>();

            auto access = check_access(user, doc_id, fs_path);
            if (!access.has_value() || access.value() < db::AccessLevel::Read) {
                continue;
            }

            std::string ltitle = to_lower(title);
            std::string lpath = to_lower(fs_path);
            std::string snippet;
            std::string match_type;

            if (ltitle.find(lq) != std::string::npos) {
                match_type = "title";
                snippet = "Matched title: " + title;
            } else if (lpath.find(lq) != std::string::npos) {
                match_type = "path";
                snippet = "Matched path: " + fs_path;
            } else {
                auto raw_res = storage_->read_file(fs_path);
                if (raw_res.has_value()) {
                    const auto& content = raw_res.value();
                    std::string lcontent = to_lower(content);
                    auto pos = lcontent.find(lq);
                    if (pos != std::string::npos) {
                        match_type = "content";
                        size_t start = pos > 35 ? pos - 35 : 0;
                        size_t end = std::min(content.size(), pos + lq.size() + 35);
                        std::string sub = content.substr(start, end - start);
                        for (auto& ch : sub) {
                            if (ch == '\n' || ch == '\r') ch = ' ';
                        }
                        snippet = (start > 0 ? "..." : "") + sub + (end < content.size() ? "..." : "");
                    }
                }
            }

            if (!match_type.empty()) {
                bool is_bundle = storage_->is_bundle(fs_path).value_or(false);
                results.push_back({
                    {"id", doc_id},
                    {"path", fs_path},
                    {"title", title},
                    {"snippet", snippet},
                    {"match_type", match_type},
                    {"updated_at", updated_at},
                    {"is_bundle", is_bundle}
                });
                if (results.size() >= limit) {
                    break;
                }
            }
        }
        return results;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] search_documents failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<nlohmann::json> DocumentService::list_trash(const auth::UserIdentity& user) {
    (void)user;
    if (!storage_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto list_res = storage_->list_trash();
    if (!list_res.has_value()) {
        return std::unexpected(list_res.error());
    }

    nlohmann::json items = nlohmann::json::array();
    for (const auto& node : list_res.value()) {
        std::time_t t = std::chrono::system_clock::to_time_t(node.last_modified);
        std::tm tm{};
#if defined(_WIN32)
        gmtime_s(&tm, &t);
#else
        gmtime_r(&t, &tm);
#endif
        std::ostringstream ss;
        ss << std::put_time(&tm, "%Y-%m-%dT%H:%M:%SZ");

        items.push_back({
            {"id", node.name},
            {"path", node.relative_path},
            {"name", node.name},
            {"size_bytes", node.size_bytes},
            {"is_directory", node.is_directory},
            {"is_bundle", node.is_bundle},
            {"deleted_at", ss.str()}
        });
    }

    return items;
}

Result<DocumentRecord> DocumentService::restore_trash_item(
    const std::string& trash_id,
    const std::string& target_path,
    const auth::UserIdentity& user
) {
    if (!storage_ || !db_pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    std::string restore_dest = target_path;
    if (restore_dest.empty()) {
        auto trash_res = storage_->list_trash();
        if (trash_res.has_value()) {
            for (const auto& item : trash_res.value()) {
                if (item.name == trash_id) {
                    restore_dest = item.relative_path;
                    break;
                }
            }
        }
    }

    if (restore_dest.empty()) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    auto rest_res = storage_->restore_from_trash(trash_id, restore_dest);
    if (!rest_res.has_value()) {
        return std::unexpected(rest_res.error());
    }

    std::string content;
    bool is_bundle = storage_->is_bundle(restore_dest).value_or(false);
    if (is_bundle) {
        auto b_res = storage_->read_file(restore_dest + "/index.md");
        content = b_res.value_or("");
    } else {
        auto f_res = storage_->read_file(restore_dest);
        content = f_res.value_or("");
    }

    std::string title = derive_title(content, restore_dest);

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "INSERT INTO documents (fs_path, title, owner_user_id) "
            "VALUES ($1, $2, $3::uuid) "
            "ON CONFLICT (fs_path) DO UPDATE SET updated_at = NOW(), title = EXCLUDED.title "
            "RETURNING id, TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
            "       TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"');",
            restore_dest,
            title,
            user.user_id
        );

        std::string doc_id = rows[0][0].as<std::string>();
        std::string created_at = rows[0][1].as<std::string>();
        std::string updated_at = rows[0][2].as<std::string>();

        tx.commit();

        return DocumentRecord{
            .id = doc_id,
            .path = restore_dest,
            .title = title,
            .content = content,
            .is_bundle = is_bundle,
            .owner_user_id = user.user_id,
            .created_at = created_at,
            .updated_at = updated_at
        };
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] restore_trash_item DB re-indexing failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<void> DocumentService::purge_trash_item(
    const std::string& trash_id,
    const auth::UserIdentity& user
) {
    (void)user;
    if (!storage_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    return storage_->purge_from_trash(trash_id);
}

Result<nlohmann::json> DocumentService::list_document_assets(
    const std::string& doc_id,
    const auth::UserIdentity& user
) {
    if (!storage_ || !db_pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    std::string fs_path;
    try {
        pqxx::read_transaction tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT fs_path FROM documents WHERE id = $1::uuid;",
            doc_id
        );
        if (rows.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }
        fs_path = rows[0][0].as<std::string>();
    } catch (...) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto access_res = check_access(user, doc_id, fs_path);
    if (!access_res.has_value() || access_res.value() < db::AccessLevel::Read) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    bool is_bundle = storage_->is_bundle(fs_path).value_or(false);
    std::string scan_dir = is_bundle ? fs_path : std::filesystem::path(fs_path).parent_path().string();

    nlohmann::json assets = nlohmann::json::array();
    auto list_res = storage_->list_directory(scan_dir, true);
    if (list_res.has_value()) {
        for (const auto& node : list_res.value()) {
            if (node.is_directory) continue;

            // Skip main document file
            std::string lower_node = to_lower_string(node.relative_path);
            if (lower_node == to_lower_string(fs_path) ||
                lower_node == to_lower_string(fs_path + "/index.md") ||
                lower_node == to_lower_string(fs_path + "/" + std::filesystem::path(fs_path).filename().string() + ".md")) {
                continue;
            }

            // Path relative to scan_dir
            std::string bundle_rel = node.relative_path;
            if (!scan_dir.empty() && bundle_rel.starts_with(scan_dir + "/")) {
                bundle_rel = bundle_rel.substr(scan_dir.length() + 1);
            }

            bool is_img = lower_node.ends_with(".png") || lower_node.ends_with(".jpg") ||
                          lower_node.ends_with(".jpeg") || lower_node.ends_with(".gif") ||
                          lower_node.ends_with(".svg") || lower_node.ends_with(".webp") ||
                          lower_node.ends_with(".ico") || lower_node.ends_with(".bmp");

            nlohmann::json asset;
            asset["name"] = node.name;
            asset["relative_path"] = node.relative_path;
            asset["bundle_relative_path"] = bundle_rel;
            asset["size_bytes"] = node.size_bytes;
            asset["is_image"] = is_img;

            std::time_t tt = std::chrono::system_clock::to_time_t(node.last_modified);
            std::stringstream ss;
            ss << std::put_time(std::gmtime(&tt), "%Y-%m-%dT%H:%M:%SZ");
            asset["last_modified"] = ss.str();

            asset["url"] = "/api/v1/workspaces/files?path=" + node.relative_path;
            assets.push_back(std::move(asset));
        }
    }

    nlohmann::json result;
    result["doc_id"] = doc_id;
    result["fs_path"] = fs_path;
    result["is_bundle"] = is_bundle;
    result["assets"] = std::move(assets);
    return result;
}

Result<void> DocumentService::delete_document_asset(
    const std::string& doc_id,
    const std::string& filename,
    const auth::UserIdentity& user
) {
    if (!storage_ || !db_pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    std::string fs_path;
    try {
        pqxx::read_transaction tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT fs_path FROM documents WHERE id = $1::uuid;",
            doc_id
        );
        if (rows.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }
        fs_path = rows[0][0].as<std::string>();
    } catch (...) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto access_res = check_access(user, doc_id, fs_path);
    if (!access_res.has_value() || access_res.value() < db::AccessLevel::Edit) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    std::string clean_fn = normalize_rel_path(filename);
    if (clean_fn.empty() || has_path_traversal(clean_fn)) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    bool is_bundle = storage_->is_bundle(fs_path).value_or(false);
    std::string asset_path;
    if (is_bundle) {
        if (clean_fn.find('/') != std::string::npos) {
            asset_path = fs_path + "/" + clean_fn;
        } else {
            asset_path = fs_path + "/images/" + clean_fn;
            if (!storage_->read_file(asset_path).has_value()) {
                asset_path = fs_path + "/" + clean_fn;
            }
        }
    } else {
        std::filesystem::path fp(fs_path);
        std::string parent = fp.parent_path().string();
        asset_path = (parent.empty() ? "" : parent + "/") + clean_fn;
    }

    auto rm_res = storage_->delete_to_trash(asset_path);
    if (!rm_res.has_value()) {
        return std::unexpected(rm_res.error());
    }

    return {};
}

Result<nlohmann::json> DocumentService::get_directory_dashboard(
    const std::string& relative_path,
    const auth::UserIdentity& user
) {
    if (!storage_ || !db_pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    std::string clean_path = normalize_rel_path(relative_path);
    if (has_path_traversal(clean_path)) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    auto access_res = check_access(user, "", clean_path);
    if (!access_res.has_value() || access_res.value() < db::AccessLevel::Read) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    auto list_res = storage_->list_directory(clean_path, false);
    if (!list_res.has_value()) {
        return std::unexpected(list_res.error());
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    struct ChildDocMeta {
        std::string id;
        std::string title;
        std::string owner_user_id;
        std::string owner_name;
        std::string updated_at;
        int comments_count{0};
        int suggestions_count{0};
        int open_tasks_count{0};
    };
    std::map<std::string, ChildDocMeta> doc_metas;
    std::map<std::string, std::pair<std::string, std::string>> dir_owners;

    try {
        pqxx::read_transaction tx(conn_res->get());

        auto doc_rows = tx.exec_params(
            R"(
            SELECT d.id, d.fs_path, d.title, COALESCE(d.owner_user_id::text, ''),
                   COALESCE(u.display_name, u.username, ''),
                   TO_CHAR(d.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                   (SELECT COUNT(*) FROM comments c WHERE c.document_id = d.id AND c.status = 'OPEN'),
                   (SELECT COUNT(*) FROM suggestions s WHERE s.document_id = d.id AND s.status = 'PENDING'),
                   (SELECT COUNT(*) FROM tasks t WHERE t.document_id = d.id AND t.is_completed = FALSE)
            FROM documents d
            LEFT JOIN users u ON d.owner_user_id = u.id
            WHERE ($1 = '' AND d.fs_path NOT LIKE '%/%') OR ($1 <> '' AND d.fs_path LIKE $1 || '/%');
            )",
            clean_path
        );

        for (const auto& r : doc_rows) {
            std::string p = r[1].as<std::string>();
            doc_metas[p] = ChildDocMeta{
                .id = r[0].as<std::string>(),
                .title = r[2].as<std::string>(),
                .owner_user_id = r[3].as<std::string>(),
                .owner_name = r[4].as<std::string>(),
                .updated_at = r[5].as<std::string>(),
                .comments_count = r[6].as<int>(),
                .suggestions_count = r[7].as<int>(),
                .open_tasks_count = r[8].as<int>()
            };
        }

        auto dir_rows = tx.exec_params(
            R"(
            SELECT dm.directory_path, COALESCE(dm.owner_user_id::text, ''),
                   COALESCE(u.display_name, u.username, '')
            FROM directory_metadata dm
            LEFT JOIN users u ON dm.owner_user_id = u.id
            WHERE ($1 = '' AND dm.directory_path NOT LIKE '%/%') OR ($1 <> '' AND dm.directory_path LIKE $1 || '/%');
            )",
            clean_path
        );

        for (const auto& r : dir_rows) {
            dir_owners[r[0].as<std::string>()] = {r[1].as<std::string>(), r[2].as<std::string>()};
        }
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] get_directory_dashboard DB query failed: " << e.what() << "\n";
    }

    nlohmann::json items = nlohmann::json::array();
    for (const auto& node : list_res.value()) {
        std::string doc_id = doc_metas.contains(node.relative_path) ? doc_metas[node.relative_path].id : "";
        auto child_access = check_access(user, doc_id, node.relative_path);
        if (child_access.has_value() && child_access.value() < db::AccessLevel::Read) {
            continue;
        }

        nlohmann::json item;
        item["name"] = node.name;
        item["path"] = node.relative_path;
        item["is_directory"] = node.is_directory;
        item["is_bundle"] = node.is_bundle;
        item["size_bytes"] = node.size_bytes;

        std::string type = "file";
        if (node.is_bundle) type = "bundle";
        else if (node.is_directory) type = "directory";
        else if (node.name.ends_with(".md") || node.name.ends_with(".markdown")) type = "document";
        item["type"] = type;

        if (doc_metas.contains(node.relative_path)) {
            const auto& m = doc_metas[node.relative_path];
            item["id"] = m.id;
            item["title"] = m.title;
            item["owner_user_id"] = m.owner_user_id;
            item["owner_name"] = m.owner_name;
            item["updated_at"] = m.updated_at;
            item["comments_count"] = m.comments_count;
            item["suggestions_count"] = m.suggestions_count;
            item["open_tasks_count"] = m.open_tasks_count;
        } else {
            if (node.is_directory && dir_owners.contains(node.relative_path)) {
                item["owner_user_id"] = dir_owners[node.relative_path].first;
                item["owner_name"] = dir_owners[node.relative_path].second;
            } else {
                item["owner_user_id"] = "";
                item["owner_name"] = "";
            }
            item["comments_count"] = 0;
            item["suggestions_count"] = 0;
            item["open_tasks_count"] = 0;

            std::time_t tt = std::chrono::system_clock::to_time_t(node.last_modified);
            std::stringstream ss;
            ss << std::put_time(std::gmtime(&tt), "%Y-%m-%dT%H:%M:%SZ");
            item["updated_at"] = ss.str();
        }

        items.push_back(std::move(item));
    }

    nlohmann::json resp;
    resp["path"] = clean_path;
    resp["items"] = std::move(items);
    return resp;
}

Result<nlohmann::json> DocumentService::get_node_permissions(
    const std::string& target_type,
    const std::string& target_id,
    const std::string& dir_path,
    const auth::UserIdentity& user
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    auto details_res = db::PermissionEngine::get_permission_details(
        conn_res->get(),
        user.user_id,
        target_type,
        target_id,
        dir_path
    );
    if (!details_res.has_value()) {
        return std::unexpected(details_res.error());
    }

    const auto& d = details_res.value();
    nlohmann::json res;
    res["target_type"] = d.target_type;
    res["target_id"] = d.target_id;
    res["target_path"] = d.target_path;
    res["effective_permission"] = db::to_string(d.effective_level);
    res["can_manage"] = d.can_manage;

    res["owner"] = {
        {"id", d.owner.id},
        {"name", d.owner.name},
        {"display_name", d.owner.display_name},
        {"is_team", d.owner.is_team}
    };

    res["explicit_grants"] = nlohmann::json::array();
    for (const auto& g : d.explicit_grants) {
        res["explicit_grants"].push_back({
            {"id", g.id},
            {"grantee_type", g.grantee_type},
            {"grantee_id", g.grantee_id},
            {"grantee_name", g.grantee_name},
            {"access_level", db::to_string(g.access_level)}
        });
    }

    res["inherited_grants"] = nlohmann::json::array();
    for (const auto& g : d.inherited_grants) {
        res["inherited_grants"].push_back({
            {"id", g.id},
            {"grantee_type", g.grantee_type},
            {"grantee_id", g.grantee_id},
            {"grantee_name", g.grantee_name},
            {"access_level", db::to_string(g.access_level)},
            {"inherited_from", g.inherited_from}
        });
    }

    return res;
}

Result<nlohmann::json> DocumentService::set_node_permission(
    const std::string& target_type,
    const std::string& target_id,
    const std::string& dir_path,
    const std::string& grantee_type,
    const std::string& grantee_id,
    const std::string& access_level,
    const auth::UserIdentity& user
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    auto details_res = db::PermissionEngine::get_permission_details(
        conn_res->get(),
        user.user_id,
        target_type,
        target_id,
        dir_path
    );
    if (!details_res.has_value() || !details_res.value().can_manage) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    std::string clean_lvl = access_level;
    for (auto& c : clean_lvl) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    if (clean_lvl != "READ" && clean_lvl != "COMMENT" && clean_lvl != "EDIT" && clean_lvl != "ADMIN") {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    try {
        pqxx::work tx(conn_res->get());
        if (target_type == "DOCUMENT") {
            tx.exec_params(
                R"(
                DELETE FROM permissions
                WHERE target_type = 'DOCUMENT' AND target_id = $1::uuid AND grantee_type = $2 AND grantee_id = $3::uuid;
                INSERT INTO permissions (target_type, target_id, grantee_type, grantee_id, access_level)
                VALUES ('DOCUMENT', $1::uuid, $2, $3::uuid, $4);
                )",
                target_id,
                grantee_type,
                grantee_id,
                clean_lvl
            );
        } else {
            std::string clean_dir = normalize_rel_path(dir_path);
            tx.exec_params(
                R"(
                DELETE FROM permissions
                WHERE target_type = 'DIRECTORY' AND COALESCE(directory_path, '') = $1 AND grantee_type = $2 AND grantee_id = $3::uuid;
                INSERT INTO permissions (target_type, directory_path, grantee_type, grantee_id, access_level)
                VALUES ('DIRECTORY', $1, $2, $3::uuid, $4);
                )",
                clean_dir,
                grantee_type,
                grantee_id,
                clean_lvl
            );
        }
        tx.commit();
        return get_node_permissions(target_type, target_id, dir_path, user);
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] set_node_permission failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<void> DocumentService::delete_node_permission(
    int64_t permission_id,
    const auth::UserIdentity& user
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        auto row = tx.exec_params(
            "SELECT target_type, COALESCE(target_id::text, ''), COALESCE(directory_path, '') FROM permissions WHERE id = $1",
            permission_id
        );
        if (row.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }

        std::string target_type = row[0][0].as<std::string>();
        std::string target_id = row[0][1].as<std::string>();
        std::string dir_path = row[0][2].as<std::string>();

        auto details = db::PermissionEngine::get_permission_details(
            conn_res->get(),
            user.user_id,
            target_type,
            target_id,
            dir_path
        );
        if (!details.has_value() || !details.value().can_manage) {
            return std::unexpected(ErrorCode::PermissionDenied);
        }

        tx.exec_params("DELETE FROM permissions WHERE id = $1", permission_id);
        tx.commit();
        return {};
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] delete_node_permission failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<void> DocumentService::transfer_node_ownership(
    const std::string& target_type,
    const std::string& target_id,
    const std::string& dir_path,
    const std::string& new_owner_user_id,
    const std::string& new_owner_team_id,
    const auth::UserIdentity& user
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    auto details = db::PermissionEngine::get_permission_details(
        conn_res->get(),
        user.user_id,
        target_type,
        target_id,
        dir_path
    );
    if (!details.has_value() || !details.value().can_manage) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    try {
        pqxx::work tx(conn_res->get());
        if (target_type == "DOCUMENT") {
            tx.exec_params(
                R"(
                UPDATE documents
                SET owner_user_id = NULLIF($2, '')::uuid,
                    owner_team_id = NULLIF($3, '')::uuid,
                    updated_at = NOW()
                WHERE id = $1::uuid;
                )",
                target_id,
                new_owner_user_id,
                new_owner_team_id
            );
        } else {
            std::string clean_dir = normalize_rel_path(dir_path);
            tx.exec_params(
                R"(
                INSERT INTO directory_metadata (directory_path, owner_user_id, owner_team_id)
                VALUES ($1, NULLIF($2, '')::uuid, NULLIF($3, '')::uuid)
                ON CONFLICT (directory_path) DO UPDATE
                SET owner_user_id = NULLIF($2, '')::uuid,
                    owner_team_id = NULLIF($3, '')::uuid,
                    updated_at = NOW();
                )",
                clean_dir,
                new_owner_user_id,
                new_owner_team_id
            );
        }
        tx.commit();
        return {};
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] transfer_node_ownership failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<nlohmann::json> DocumentService::get_assignable_principals(
    const auth::UserIdentity& user
) {
    (void)user;
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::read_transaction tx(conn_res->get());
        auto u_rows = tx.exec(
            "SELECT id::text, username, COALESCE(display_name, username) FROM users ORDER BY username ASC"
        );
        auto t_rows = tx.exec(
            "SELECT id::text, name, COALESCE(description, '') FROM teams ORDER BY name ASC"
        );

        nlohmann::json users = nlohmann::json::array();
        for (const auto& r : u_rows) {
            users.push_back({
                {"id", r[0].as<std::string>()},
                {"username", r[1].as<std::string>()},
                {"display_name", r[2].as<std::string>()}
            });
        }

        nlohmann::json teams = nlohmann::json::array();
        for (const auto& r : t_rows) {
            teams.push_back({
                {"id", r[0].as<std::string>()},
                {"name", r[1].as<std::string>()},
                {"description", r[2].as<std::string>()}
            });
        }

        return nlohmann::json{
            {"users", std::move(users)},
            {"teams", std::move(teams)}
        };
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] get_assignable_principals failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

} // namespace cme::document
