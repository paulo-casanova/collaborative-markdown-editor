#include "cme/document/document_service.hpp"
#include <filesystem>
#include <iostream>
#include <sstream>
#include <algorithm>
#include <cctype>
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

        std::string query =
            "INSERT INTO documents (fs_path, title, owner_user_id) "
            "VALUES ($1, $2, NULLIF($3, '')::uuid) "
            "RETURNING id, fs_path, title, COALESCE(owner_user_id::text, ''), "
            "          TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
            "          TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"');";

        auto row = tx.exec_params(query, norm_path, title, user.user_id);
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

Result<DocumentRecord> DocumentService::get_document_by_id(
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

    std::string norm_path = normalize_rel_path(relative_path);
    if (norm_path.empty() || has_path_traversal(norm_path)) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    try {
        pqxx::work tx(conn_res->get());

        auto rows = tx.exec_params(
            "SELECT id, fs_path, title, COALESCE(owner_user_id::text, ''), "
            "       TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
            "       TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
            "FROM documents WHERE fs_path = $1;",
            norm_path
        );

        std::string doc_id;
        std::string title;
        std::string owner_user_id;
        std::string created_at;
        std::string updated_at;

        if (rows.empty()) {
            // Check if file exists on disk (Auto-reconciliation)
            auto disk_exists = storage_->exists(norm_path);
            if (!disk_exists.has_value() || !disk_exists.value()) {
                return std::unexpected(ErrorCode::NotFound);
            }

            bool is_bundle = storage_->is_bundle(norm_path).value_or(false);
            std::string content_file = is_bundle ? (norm_path + "/index.md") : norm_path;
            auto content_res = storage_->read_file(content_file);
            std::string disk_content = content_res.has_value() ? content_res.value() : "";

            title = derive_title(disk_content, norm_path);

            auto ins_rows = tx.exec_params(
                "INSERT INTO documents (fs_path, title, owner_user_id) "
                "VALUES ($1, $2, NULLIF($3, '')::uuid) "
                "RETURNING id, TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
                "          TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"');",
                norm_path,
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
            title = r[2].as<std::string>();
            owner_user_id = r[3].as<std::string>();
            created_at = r[4].as<std::string>();
            updated_at = r[5].as<std::string>();
        }

        tx.commit();

        // Check permission
        auto access_res = check_access(user, doc_id, norm_path);
        if (!access_res.has_value()) {
            return std::unexpected(access_res.error());
        }
        if (access_res.value() < db::AccessLevel::Read) {
            return std::unexpected(ErrorCode::PermissionDenied);
        }

        bool is_bundle = storage_->is_bundle(norm_path).value_or(false);
        std::string content_file = is_bundle ? (norm_path + "/index.md") : norm_path;
        auto read_res = storage_->read_file(content_file);
        std::string content = read_res.has_value() ? read_res.value() : "";

        return DocumentRecord{
            .id = doc_id,
            .path = norm_path,
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
    const auth::UserIdentity& user
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

        // Update database record
        auto up_rows = tx.exec_params(
            "UPDATE documents SET fs_path = $2, updated_at = NOW() WHERE id = $1::uuid "
            "RETURNING TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
            "          TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"');",
            doc_id,
            norm_new_path
        );

        std::string created_at = up_rows[0][0].as<std::string>();
        std::string updated_at = up_rows[0][1].as<std::string>();
        tx.commit();

        bool is_bundle = storage_->is_bundle(norm_new_path).value_or(false);

        return DocumentRecord{
            .id = doc_id,
            .path = norm_new_path,
            .title = title,
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

Result<nlohmann::json> DocumentService::get_workspace_tree(const auth::UserIdentity& user) {
    if (!storage_ || !db_pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    struct DocMeta {
        std::string id;
        std::string title;
        std::string owner_id;
        std::string updated_at;
    };

    std::map<std::string, DocMeta> indexed_docs;

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

    // List storage nodes recursively
    auto list_res = storage_->list_directory("", true);
    if (!list_res.has_value()) {
        return std::unexpected(list_res.error());
    }

    nlohmann::json items = nlohmann::json::array();
    for (const auto& node : list_res.value()) {
        // Skip internal bundle assets and images subfolders in tree listing
        if (node.relative_path.find("/images/") != std::string::npos ||
            node.name == "images") {
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
            item["title"] = derive_title("", node.relative_path);
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

} // namespace cme::document
