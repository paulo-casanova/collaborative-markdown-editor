#include "cme/document/document_service.hpp"
#include <filesystem>
#include <iostream>
#include <sstream>
#include <algorithm>
#include <cctype>
#include <chrono>
#include <iomanip>
#include <map>
#include <zlib.h>

namespace cme::document {

namespace {

struct ZipFileEntry {
    std::string path_in_zip;
    std::string data;
};

std::string create_zip_archive(const std::vector<ZipFileEntry>& entries) {
    std::string zip;
    struct CentralDirHeader {
        std::string path;
        uint32_t crc{0};
        uint32_t comp_size{0};
        uint32_t uncomp_size{0};
        uint32_t local_header_offset{0};
        uint16_t method{0};
    };
    std::vector<CentralDirHeader> cd_headers;

    auto write_u16 = [](std::string& s, uint16_t v) {
        s.push_back(static_cast<char>(v & 0xFF));
        s.push_back(static_cast<char>((v >> 8) & 0xFF));
    };
    auto write_u32 = [](std::string& s, uint32_t v) {
        s.push_back(static_cast<char>(v & 0xFF));
        s.push_back(static_cast<char>((v >> 8) & 0xFF));
        s.push_back(static_cast<char>((v >> 16) & 0xFF));
        s.push_back(static_cast<char>((v >> 24) & 0xFF));
    };

    for (const auto& entry : entries) {
        uint32_t local_offset = static_cast<uint32_t>(zip.size());
        uint32_t crc = static_cast<uint32_t>(
            crc32(0L, reinterpret_cast<const Bytef*>(entry.data.data()), static_cast<uInt>(entry.data.size()))
        );

        std::string deflated;
        bool use_deflate = false;
        if (!entry.data.empty()) {
            z_stream strm{};
            if (deflateInit2(&strm, Z_DEFAULT_COMPRESSION, Z_DEFLATED, -MAX_WBITS, 8, Z_DEFAULT_STRATEGY) == Z_OK) {
                deflated.resize(entry.data.size() + 512);
                strm.next_in = reinterpret_cast<Bytef*>(const_cast<char*>(entry.data.data()));
                strm.avail_in = static_cast<uInt>(entry.data.size());
                strm.next_out = reinterpret_cast<Bytef*>(deflated.data());
                strm.avail_out = static_cast<uInt>(deflated.size());
                if (deflate(&strm, Z_FINISH) == Z_STREAM_END) {
                    deflated.resize(strm.total_out);
                    if (deflated.size() < entry.data.size()) {
                        use_deflate = true;
                    }
                }
                deflateEnd(&strm);
            }
        }

        uint16_t method = use_deflate ? 8 : 0;
        const std::string& payload = use_deflate ? deflated : entry.data;
        uint32_t comp_size = static_cast<uint32_t>(payload.size());
        uint32_t uncomp_size = static_cast<uint32_t>(entry.data.size());

        // Local file header: 0x04034b50
        write_u32(zip, 0x04034b50);
        write_u16(zip, 20); // version needed: 2.0
        write_u16(zip, 0x0800); // flags: UTF-8 filename
        write_u16(zip, method);
        write_u16(zip, 0); // mod time
        write_u16(zip, 0); // mod date
        write_u32(zip, crc);
        write_u32(zip, comp_size);
        write_u32(zip, uncomp_size);
        write_u16(zip, static_cast<uint16_t>(entry.path_in_zip.size()));
        write_u16(zip, 0); // extra field len
        zip.append(entry.path_in_zip);
        zip.append(payload);

        cd_headers.push_back({
            .path = entry.path_in_zip,
            .crc = crc,
            .comp_size = comp_size,
            .uncomp_size = uncomp_size,
            .local_header_offset = local_offset,
            .method = method,
        });
    }

    uint32_t cd_offset = static_cast<uint32_t>(zip.size());
    for (const auto& cd : cd_headers) {
        // Central directory header: 0x02014b50
        write_u32(zip, 0x02014b50);
        write_u16(zip, 20); // version made by
        write_u16(zip, 20); // version needed
        write_u16(zip, 0x0800); // UTF-8
        write_u16(zip, cd.method);
        write_u16(zip, 0);
        write_u16(zip, 0);
        write_u32(zip, cd.crc);
        write_u32(zip, cd.comp_size);
        write_u32(zip, cd.uncomp_size);
        write_u16(zip, static_cast<uint16_t>(cd.path.size()));
        write_u16(zip, 0); // extra len
        write_u16(zip, 0); // comment len
        write_u16(zip, 0); // disk num
        write_u16(zip, 0); // internal attr
        write_u32(zip, 0); // external attr
        write_u32(zip, cd.local_header_offset);
        zip.append(cd.path);
    }
    uint32_t cd_size = static_cast<uint32_t>(zip.size() - cd_offset);

    // End of central directory record: 0x06054b50
    write_u32(zip, 0x06054b50);
    write_u16(zip, 0); // disk num
    write_u16(zip, 0); // start disk
    write_u16(zip, static_cast<uint16_t>(cd_headers.size()));
    write_u16(zip, static_cast<uint16_t>(cd_headers.size()));
    write_u32(zip, cd_size);
    write_u32(zip, cd_offset);
    write_u16(zip, 0); // comment len

    return zip;
}

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
    std::shared_ptr<storage::IStorageBackend> storage
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
    if (is_bundle && !norm_path.ends_with(".bundle")) {
        norm_path += ".bundle";
    } else if (!is_bundle && !norm_path.ends_with(".md")) {
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
            "INSERT INTO documents (fs_path, title, owner_user_id, owner_team_id, number_headers) "
            "VALUES ($1, $2, NULLIF($3, '')::uuid, NULLIF($4, '')::uuid, $5) "
            "RETURNING id, fs_path, title, COALESCE(owner_user_id::text, ''), "
            "          COALESCE(number_headers, false), "
            "          TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
            "          TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"');";

        auto row = tx.exec_params(query, norm_path, title, owner_id, owner_team_id, req.number_headers);
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
            .number_headers = row[0][4].as<bool>(),
            .created_at = row[0][5].as<std::string>(),
            .updated_at = row[0][6].as<std::string>()
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

Result<std::string> DocumentService::rename_directory(
    const std::string& old_path,
    const std::string& new_path,
    const auth::UserIdentity& user
) {
    if (!storage_ || !db_pool_) {
        return std::unexpected(ErrorCode::IoError);
    }

    std::string norm_old = normalize_rel_path(old_path);
    std::string norm_new = normalize_rel_path(new_path);

    if (norm_old.empty() || norm_new.empty() ||
        has_path_traversal(norm_old) || has_path_traversal(norm_new)) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    if (norm_old == norm_new) {
        return norm_new;
    }

    // A directory cannot be moved into a subdirectory of itself
    if (norm_new.starts_with(norm_old + "/")) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    // Check old directory exists and is a directory
    auto info_res = storage_->get_node_info(norm_old);
    if (!info_res.has_value()) {
        return std::unexpected(info_res.error());
    }
    if (!info_res->is_directory) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    // Check if new path already exists
    auto exists_res = storage_->exists(norm_new);
    if (exists_res.has_value() && exists_res.value()) {
        return std::unexpected(ErrorCode::AlreadyExists);
    }

    // Check permissions
    auto access_old = check_access(user, "", norm_old);
    if (!access_old.has_value() || access_old.value() < db::AccessLevel::Edit) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    std::filesystem::path fp_new(norm_new);
    std::string new_parent = fp_new.parent_path().string();
    if (!new_parent.empty()) {
        auto access_new = check_access(user, "", new_parent);
        if (!access_new.has_value() || access_new.value() < db::AccessLevel::Edit) {
            return std::unexpected(ErrorCode::PermissionDenied);
        }
    }

    // Perform storage move
    auto move_res = storage_->move_node(norm_old, norm_new);
    if (!move_res.has_value()) {
        return std::unexpected(move_res.error());
    }

    // Update database records in transaction
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    try {
        pqxx::work tx(conn_res->get());

        // Update documents table (exact match or children)
        tx.exec_params(
            R"(
            UPDATE documents
            SET fs_path = $2 || SUBSTRING(fs_path FROM LENGTH($1) + 1),
                updated_at = NOW()
            WHERE fs_path = $1 OR fs_path LIKE $1 || '/%';
            )",
            norm_old,
            norm_new
        );

        // Update directory permissions
        tx.exec_params(
            R"(
            UPDATE permissions
            SET directory_path = $2 || SUBSTRING(directory_path FROM LENGTH($1) + 1)
            WHERE target_type = 'DIRECTORY'
              AND (directory_path = $1 OR directory_path LIKE $1 || '/%');
            )",
            norm_old,
            norm_new
        );

        // Update directory_metadata
        tx.exec_params(
            R"(
            UPDATE directory_metadata
            SET directory_path = $2 || SUBSTRING(directory_path FROM LENGTH($1) + 1),
                updated_at = NOW()
            WHERE directory_path = $1 OR directory_path LIKE $1 || '/%';
            )",
            norm_old,
            norm_new
        );

        tx.commit();
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] rename_directory DB update failed: " << e.what() << "\n";
        // Attempt rollback storage move
        storage_->move_node(norm_new, norm_old);
        return std::unexpected(ErrorCode::DatabaseError);
    }

    return norm_new;
}

Result<std::string> DocumentService::delete_directory(
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

    // Check directory exists and is a directory
    auto info_res = storage_->get_node_info(norm_path);
    if (!info_res.has_value()) {
        return std::unexpected(info_res.error());
    }
    if (!info_res->is_directory) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    // Check permission
    auto access_res = check_access(user, "", norm_path);
    if (!access_res.has_value() || access_res.value() < db::AccessLevel::Edit) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    // Perform storage soft-delete to trash
    auto trash_res = storage_->delete_to_trash(norm_path);
    if (!trash_res.has_value()) {
        return std::unexpected(trash_res.error());
    }

    std::string trash_id = trash_res.value();

    // Clean up DB records
    auto conn_res = db_pool_->acquire();
    if (conn_res.has_value()) {
        try {
            pqxx::work tx(conn_res->get());

            // Find all documents inside directory
            auto doc_rows = tx.exec_params(
                "SELECT id::text FROM documents WHERE fs_path = $1 OR fs_path LIKE $1 || '/%';",
                norm_path
            );

            // Clean up CRDT state for each doc
            for (const auto& r : doc_rows) {
                storage_->delete_crdt_state(r[0].as<std::string>());
            }

            // Delete documents (cascades to permissions, comments, tasks, suggestions)
            tx.exec_params(
                "DELETE FROM documents WHERE fs_path = $1 OR fs_path LIKE $1 || '/%';",
                norm_path
            );

            // Delete directory permissions
            tx.exec_params(
                "DELETE FROM permissions WHERE target_type = 'DIRECTORY' AND (directory_path = $1 OR directory_path LIKE $1 || '/%');",
                norm_path
            );

            // Delete directory metadata
            tx.exec_params(
                "DELETE FROM directory_metadata WHERE directory_path = $1 OR directory_path LIKE $1 || '/%';",
                norm_path
            );

            tx.commit();
        } catch (const std::exception& e) {
            std::cerr << "[ERROR] delete_directory DB cleanup failed: " << e.what() << "\n";
            return std::unexpected(ErrorCode::DatabaseError);
        }
    }

    return trash_id;
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
            "       COALESCE(number_headers, false), "
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

        bool is_bundle = fs_path.ends_with(".bundle") && storage_->is_bundle(fs_path).value_or(false);
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
            .number_headers = r[4].as<bool>(),
            .created_at = r[5].as<std::string>(),
            .updated_at = r[6].as<std::string>()
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

        auto validate_and_purge_dir_rows = [&](pqxx::result& r_set) {
            if (r_set.empty()) return;
            std::string existing_fs = r_set[0][1].as<std::string>();
            auto info_res = storage_->get_node_info(existing_fs);
            if (info_res.has_value() && info_res->is_directory && !existing_fs.ends_with(".bundle")) {
                // Stale directory row in documents table! Purge it.
                tx.exec_params("DELETE FROM documents WHERE id = $1::uuid;", r_set[0][0].as<std::string>());
                r_set = pqxx::result();
            }
        };

        // 1. Exact fs_path match
        auto rows = tx.exec_params(
            "SELECT id, fs_path, title, COALESCE(owner_user_id::text, ''), "
            "       COALESCE(number_headers, false), "
            "       TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
            "       TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
            "FROM documents WHERE fs_path = $1;",
            norm_path
        );
        validate_and_purge_dir_rows(rows);

        // 2. Exact fs_path with .md extension or folder note resolution (<dir>/<basename>.md or <dir>/index.md)
        if (rows.empty() && !norm_path.ends_with(".md") && !norm_path.ends_with(".bundle")) {
            rows = tx.exec_params(
                "SELECT id, fs_path, title, COALESCE(owner_user_id::text, ''), "
                "       COALESCE(number_headers, false), "
                "       TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
                "       TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
                "FROM documents "
                "WHERE fs_path = $1 "
                "   OR fs_path = $2 "
                "   OR fs_path = $3 "
                "ORDER BY CASE "
                "   WHEN fs_path = $1 THEN 1 "
                "   WHEN fs_path = $2 THEN 2 "
                "   ELSE 3 "
                "END "
                "LIMIT 1;",
                norm_path + ".md",
                norm_path + "/" + basename + ".md",
                norm_path + "/index.md"
            );
            validate_and_purge_dir_rows(rows);
        }

        // 3. Exact title match (norm_path or stem) on valid document files/bundles
        if (rows.empty()) {
            rows = tx.exec_params(
                "SELECT id, fs_path, title, COALESCE(owner_user_id::text, ''), "
                "       COALESCE(number_headers, false), "
                "       TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
                "       TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
                "FROM documents "
                "WHERE (title = $1 OR title = $2) "
                "  AND (fs_path LIKE '%.md' OR fs_path LIKE '%.bundle') "
                "LIMIT 1;",
                norm_path,
                stem
            );
            validate_and_purge_dir_rows(rows);
        }

        // 4. Vault-wide basename match (e.g. [[Test File Modified]] matches specs/Test File Modified.md)
        if (rows.empty()) {
            rows = tx.exec_params(
                "SELECT id, fs_path, title, COALESCE(owner_user_id::text, ''), "
                "       COALESCE(number_headers, false), "
                "       TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
                "       TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
                "FROM documents "
                "WHERE (fs_path LIKE '%.md' OR fs_path LIKE '%.bundle') "
                "  AND (fs_path = $1 "
                "   OR fs_path = $1 || '.md' "
                "   OR fs_path = $1 || '.bundle' "
                "   OR fs_path LIKE '%/' || $1 "
                "   OR fs_path LIKE '%/' || $1 || '.md' "
                "   OR fs_path LIKE '%/' || $1 || '.bundle' "
                "   OR fs_path = $2 "
                "   OR fs_path = $2 || '.md' "
                "   OR fs_path = $2 || '.bundle' "
                "   OR fs_path LIKE '%/' || $2 "
                "   OR fs_path LIKE '%/' || $2 || '.md' "
                "   OR fs_path LIKE '%/' || $2 || '.bundle') "
                "LIMIT 1;",
                basename,
                stem
            );
            validate_and_purge_dir_rows(rows);
        }

        // 5. Case-insensitive match on fs_path, basename, or title (ILIKE)
        if (rows.empty()) {
            rows = tx.exec_params(
                "SELECT id, fs_path, title, COALESCE(owner_user_id::text, ''), "
                "       COALESCE(number_headers, false), "
                "       TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
                "       TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
                "FROM documents "
                "WHERE (fs_path ILIKE '%.md' OR fs_path ILIKE '%.bundle') "
                "  AND (fs_path ILIKE $1 "
                "   OR fs_path ILIKE $1 || '.md' "
                "   OR fs_path ILIKE $1 || '.bundle' "
                "   OR fs_path ILIKE '%/' || $1 "
                "   OR fs_path ILIKE '%/' || $1 || '.md' "
                "   OR fs_path ILIKE '%/' || $1 || '.bundle' "
                "   OR fs_path ILIKE $2 "
                "   OR fs_path ILIKE $2 || '.md' "
                "   OR fs_path ILIKE $2 || '.bundle' "
                "   OR fs_path ILIKE '%/' || $2 "
                "   OR fs_path ILIKE '%/' || $2 || '.md' "
                "   OR fs_path ILIKE '%/' || $2 || '.bundle' "
                "   OR title ILIKE $1 "
                "   OR title ILIKE $2) "
                "LIMIT 1;",
                basename,
                stem
            );
            validate_and_purge_dir_rows(rows);
        }

        // 6. Typo-tolerant / fuzzy match across all existing documents (Levenshtein distance <= 2 or 3)
        if (rows.empty()) {
            auto all_docs = tx.exec(
                "SELECT id, fs_path, title, COALESCE(owner_user_id::text, ''), "
                "       COALESCE(number_headers, false), "
                "       TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
                "       TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
                "FROM documents "
                "WHERE fs_path LIKE '%.md' OR fs_path LIKE '%.bundle';"
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
                    "       COALESCE(number_headers, false), "
                    "       TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
                    "       TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
                    "FROM documents WHERE id = $1::uuid;",
                    best_id
                );
                validate_and_purge_dir_rows(rows);
            }
        }

        std::string doc_id;
        std::string actual_fs_path;
        std::string title;
        std::string owner_user_id;
        bool number_headers = false;
        std::string created_at;
        std::string updated_at;

        if (rows.empty()) {
            // Check storage on disk (Auto-reconciliation)
            std::string disk_target_path = norm_path;
            auto info_res = storage_->get_node_info(disk_target_path);
            bool is_pure_dir = info_res.has_value() && info_res->is_directory && !disk_target_path.ends_with(".bundle");

            if (is_pure_dir) {
                // A pure directory is not a document; resolve to <dir>/<dir>.md or <dir>/index.md if present
                if (storage_->exists(disk_target_path + "/" + basename + ".md").value_or(false)) {
                    disk_target_path = disk_target_path + "/" + basename + ".md";
                } else if (storage_->exists(disk_target_path + "/index.md").value_or(false)) {
                    disk_target_path = disk_target_path + "/index.md";
                } else {
                    return std::unexpected(ErrorCode::NotFound);
                }
            } else if (!info_res.has_value()) {
                if (!disk_target_path.ends_with(".md") && storage_->exists(disk_target_path + ".md").value_or(false)) {
                    disk_target_path += ".md";
                } else if (storage_->exists(disk_target_path + "/" + basename + ".md").value_or(false)) {
                    disk_target_path = disk_target_path + "/" + basename + ".md";
                } else if (storage_->exists(disk_target_path + "/index.md").value_or(false)) {
                    disk_target_path = disk_target_path + "/index.md";
                } else {
                    auto list_res = storage_->list_directory("", true);
                    if (list_res.has_value()) {
                        for (const auto& node : list_res.value()) {
                            if (node.is_directory && !node.is_bundle) continue;
                            std::filesystem::path np(node.relative_path);
                            if (np.filename().string() == basename ||
                                np.filename().string() == basename + ".md" ||
                                np.stem().string() == stem ||
                                to_lower_string(np.filename().string()) == to_lower_string(basename + ".md") ||
                                to_lower_string(np.stem().string()) == to_lower_string(stem)) {
                                disk_target_path = node.relative_path;
                                break;
                            }
                        }
                    }
                }
            }

            auto final_info = storage_->get_node_info(disk_target_path);
            if (!final_info.has_value()) {
                return std::unexpected(ErrorCode::NotFound);
            }
            if (final_info->is_directory && !disk_target_path.ends_with(".bundle")) {
                return std::unexpected(ErrorCode::NotFound);
            }

            actual_fs_path = disk_target_path;
            bool is_bundle = disk_target_path.ends_with(".bundle") && storage_->is_bundle(actual_fs_path).value_or(false);
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
            number_headers = r[4].as<bool>();
            created_at = r[5].as<std::string>();
            updated_at = r[6].as<std::string>();
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

        bool is_bundle = actual_fs_path.ends_with(".bundle") && storage_->is_bundle(actual_fs_path).value_or(false);
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
            .number_headers = number_headers,
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
    std::optional<std::string> content,
    std::optional<std::string> title,
    const auth::UserIdentity& user,
    std::optional<bool> number_headers
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
            "SELECT id, fs_path, title, COALESCE(owner_user_id::text, ''), COALESCE(number_headers, false) "
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
        bool current_num_h = r[4].as<bool>();

        // Check permission
        auto access_res = check_access(user, doc_id, fs_path);
        if (!access_res.has_value()) {
            return std::unexpected(access_res.error());
        }
        if (access_res.value() < db::AccessLevel::Edit) {
            return std::unexpected(ErrorCode::PermissionDenied);
        }

        bool is_bundle = storage_->is_bundle(fs_path).value_or(false);
        std::string content_file = is_bundle ? (fs_path + "/index.md") : fs_path;

        std::string final_content;
        if (content.has_value()) {
            final_content = *content;
            auto write_res = storage_->write_file(content_file, final_content, true);
            if (!write_res.has_value()) {
                return std::unexpected(write_res.error());
            }
        } else {
            auto read_res = storage_->read_file(content_file);
            final_content = read_res.has_value() ? read_res.value() : "";
        }

        std::string new_title = title.value_or(current_title);
        bool new_num_h = number_headers.value_or(current_num_h);

        auto up_rows = tx.exec_params(
            "UPDATE documents SET title = $2, number_headers = $3, updated_at = NOW() WHERE id = $1::uuid "
            "RETURNING TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
            "          TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"');",
            doc_id,
            new_title,
            new_num_h
        );

        std::string created_at = up_rows[0][0].as<std::string>();
        std::string updated_at = up_rows[0][1].as<std::string>();
        tx.commit();

        return DocumentRecord{
            .id = doc_id,
            .path = fs_path,
            .title = new_title,
            .content = std::move(final_content),
            .is_bundle = is_bundle,
            .owner_user_id = owner_id,
            .number_headers = new_num_h,
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
            "SELECT id, fs_path, title, COALESCE(owner_user_id::text, ''), COALESCE(number_headers, false) "
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
        bool num_h = r[4].as<bool>();

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
            .number_headers = num_h,
            .created_at = created_at,
            .updated_at = updated_at
        };
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] move_document failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<DocumentRecord> DocumentService::convert_document(
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
            "SELECT fs_path, title, owner_user_id::text, number_headers FROM documents WHERE id = $1::uuid;",
            doc_id
        );
        if (rows.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }

        std::string old_fs_path = rows[0][0].as<std::string>();
        std::string title = rows[0][1].as<std::string>();
        std::string owner_id = rows[0][2].as<std::string>();
        bool num_h = rows[0][3].as<bool>();

        // Check permission (Edit access required)
        auto access_res = check_access(user, doc_id, old_fs_path);
        if (!access_res.has_value() || access_res.value() < db::AccessLevel::Edit) {
            return std::unexpected(ErrorCode::PermissionDenied);
        }

        bool currently_bundle = storage_->is_bundle(old_fs_path).value_or(false) || old_fs_path.ends_with(".bundle");
        std::string new_fs_path;

        if (!currently_bundle) {
            // Convert Document -> Bundle
            // e.g., "Notes/MyDoc.md" -> "Notes/MyDoc.bundle"
            std::string base = old_fs_path;
            if (base.ends_with(".md")) {
                base = base.substr(0, base.size() - 3);
            } else if (base.ends_with(".markdown")) {
                base = base.substr(0, base.size() - 9);
            }
            new_fs_path = base + ".bundle";

            if (storage_->exists(new_fs_path).value_or(false)) {
                return std::unexpected(ErrorCode::AlreadyExists);
            }
            if (!storage_->exists(old_fs_path).value_or(false)) {
                return std::unexpected(ErrorCode::NotFound);
            }

            auto dir_res = storage_->create_directory(new_fs_path);
            if (!dir_res.has_value()) {
                return std::unexpected(dir_res.error());
            }

            std::string target_index = new_fs_path + "/index.md";
            auto move_res = storage_->move_node(old_fs_path, target_index);
            if (!move_res.has_value()) {
                return std::unexpected(move_res.error());
            }
        } else {
            // Convert Bundle -> Document
            // e.g., "Notes/MyDoc.bundle" -> "Notes/MyDoc.md"
            std::string base = old_fs_path;
            if (base.ends_with(".bundle")) {
                base = base.substr(0, base.size() - 7);
            }
            new_fs_path = base + ".md";

            if (storage_->exists(new_fs_path).value_or(false)) {
                return std::unexpected(ErrorCode::AlreadyExists);
            }

            std::string old_index = old_fs_path + "/index.md";
            if (!storage_->exists(old_index).value_or(false)) {
                return std::unexpected(ErrorCode::NotFound);
            }

            // Move any sibling assets inside the bundle to parent directory
            std::filesystem::path bundle_p(old_fs_path);
            std::string parent_dir = bundle_p.parent_path().string();

            auto child_res = storage_->list_directory(old_fs_path, true);
            if (child_res.has_value()) {
                for (const auto& child : child_res.value()) {
                    if (child.is_directory) continue;
                    if (child.relative_path == old_index) continue;

                    // Calculate destination path relative to parent_dir
                    std::filesystem::path child_p(child.relative_path);
                    std::string sub = std::filesystem::relative(child_p, bundle_p).string();
                    std::string dest_asset = (parent_dir.empty() ? "" : parent_dir + "/") + sub;

                    if (!storage_->exists(dest_asset).value_or(false)) {
                        storage_->move_node(child.relative_path, dest_asset);
                    }
                }
            }

            // Move index.md to new_fs_path
            auto move_res = storage_->move_node(old_index, new_fs_path);
            if (!move_res.has_value()) {
                return std::unexpected(move_res.error());
            }

            // Clean up remaining empty bundle directory
            auto trash_res = storage_->delete_to_trash(old_fs_path);
            if (trash_res.has_value()) {
                storage_->purge_from_trash(trash_res.value());
            }
        }

        // Update database record
        auto up_rows = tx.exec_params(
            "UPDATE documents SET fs_path = $2, updated_at = NOW() WHERE id = $1::uuid "
            "RETURNING TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), "
            "          TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"');",
            doc_id,
            new_fs_path
        );
        std::string created_at = up_rows[0][0].as<std::string>();
        std::string updated_at = up_rows[0][1].as<std::string>();
        tx.commit();

        bool is_bundle_res = storage_->is_bundle(new_fs_path).value_or(false);

        return DocumentRecord{
            .id = doc_id,
            .path = new_fs_path,
            .title = title,
            .content = "",
            .is_bundle = is_bundle_res,
            .owner_user_id = owner_id,
            .number_headers = num_h,
            .created_at = created_at,
            .updated_at = updated_at
        };
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] convert_document failed: " << e.what() << "\n";
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

        bool is_bundle = fs_path.ends_with(".bundle") && storage_->is_bundle(fs_path).value_or(false);
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
            .number_headers = false,
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

        std::vector<std::string> stale_ids;
        try {
            pqxx::read_transaction tx(conn_res->get());
            auto rows = tx.exec(
                "SELECT id, fs_path, title, COALESCE(owner_user_id::text, ''), "
                "       TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
                "FROM documents;"
            );
            for (const auto& r : rows) {
                std::string p = r[1].as<std::string>();
                bool is_bundle_path = p.ends_with(".bundle");
                auto n_info = storage_->get_node_info(p);
                if (n_info.has_value() && n_info->is_directory && !is_bundle_path) {
                    stale_ids.push_back(r[0].as<std::string>());
                    continue;
                }
                indexed_docs[p] = DocMeta{
                    .id = r[0].as<std::string>(),
                    .title = r[2].as<std::string>(),
                    .owner_id = r[3].as<std::string>(),
                    .updated_at = r[4].as<std::string>()
                };
            }
        } catch (const std::exception& e) {
            std::cerr << "[ERROR] get_workspace_tree DB fetch failed: " << e.what() << "\n";
        }

        if (!stale_ids.empty()) {
            try {
                pqxx::work wtx(conn_res->get());
                for (const auto& sid : stale_ids) {
                    wtx.exec_params("DELETE FROM documents WHERE id = $1::uuid;", sid);
                }
                wtx.commit();
            } catch (const std::exception& e) {
                std::cerr << "[WARN] Purging stale directory records in get_workspace_tree failed: " << e.what() << "\n";
            }
        }

        // Auto-reconcile unindexed documents & files found on disk
        std::vector<std::string> unindexed_paths;
        for (const auto& node : list_res.value()) {
            if (!node.is_directory || (node.is_bundle && node.relative_path.ends_with(".bundle"))) {
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
                    bool is_bundle = path.ends_with(".bundle") && storage_->is_bundle(path).value_or(false);
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

        bool is_bundle_node = node.is_bundle && node.relative_path.ends_with(".bundle");
        nlohmann::json item;
        item["name"] = node.name;
        item["path"] = node.relative_path;
        item["is_directory"] = node.is_directory;
        item["is_bundle"] = is_bundle_node;
        item["size_bytes"] = node.size_bytes;

        if (indexed_docs.contains(node.relative_path) && (!node.is_directory || is_bundle_node)) {
            const auto& meta = indexed_docs[node.relative_path];
            item["id"] = meta.id;
            item["title"] = meta.title;
            item["owner_user_id"] = meta.owner_id;
            item["updated_at"] = meta.updated_at;
        } else if (!node.is_directory || is_bundle_node) {
            std::string lower_path = to_lower_string(node.relative_path);
            bool is_md = is_bundle_node || lower_path.ends_with(".md") || lower_path.ends_with(".markdown");
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
                bool is_bundle = fs_path.ends_with(".bundle") && (storage_ ? storage_->is_bundle(fs_path).value_or(false) : false);
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

    bool is_bundle = storage_->is_bundle(restore_dest).value_or(false);
    auto info_res = storage_->get_node_info(restore_dest);
    bool is_pure_dir = info_res.has_value() && info_res->is_directory && !is_bundle;

    if (is_pure_dir) {
        auto conn_res = db_pool_->acquire();
        if (conn_res.has_value()) {
            try {
                pqxx::work tx(conn_res->get());
                tx.exec_params(
                    "INSERT INTO directory_metadata (directory_path, owner_user_id) "
                    "VALUES ($1, $2::uuid) ON CONFLICT (directory_path) DO UPDATE SET updated_at = NOW();",
                    restore_dest,
                    user.user_id
                );
                auto list_res = storage_->list_directory(restore_dest, true);
                if (list_res.has_value()) {
                    for (const auto& child : list_res.value()) {
                        if (child.is_directory && !child.is_bundle) continue;
                        if (child.relative_path.find("/images/") != std::string::npos ||
                            child.relative_path.find(".bundle/") != std::string::npos) {
                            continue;
                        }
                        std::string doc_content;
                        if (child.is_bundle) {
                            auto r = storage_->read_file(child.relative_path + "/index.md");
                            if (r) doc_content = *r;
                        } else {
                            auto r = storage_->read_file(child.relative_path);
                            if (r) doc_content = *r;
                        }
                        std::string doc_title = derive_title(doc_content, child.relative_path);
                        tx.exec_params(
                            "INSERT INTO documents (fs_path, title, owner_user_id) "
                            "VALUES ($1, $2, $3::uuid) "
                            "ON CONFLICT (fs_path) DO UPDATE SET updated_at = NOW(), title = EXCLUDED.title;",
                            child.relative_path,
                            doc_title,
                            user.user_id
                        );
                    }
                }
                tx.commit();
            } catch (const std::exception& e) {
                std::cerr << "[ERROR] restore_trash_item directory re-indexing failed: " << e.what() << "\n";
            }
        }
        return DocumentRecord{
            .id = "",
            .path = restore_dest,
            .title = restore_dest,
            .content = "",
            .is_bundle = false,
            .owner_user_id = user.user_id,
            .number_headers = false,
            .created_at = "",
            .updated_at = ""
        };
    }

    std::string content;
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
            .number_headers = false,
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

    bool is_bundle = fs_path.ends_with(".bundle") && storage_->is_bundle(fs_path).value_or(false);
    std::string scan_dir = is_bundle ? fs_path : std::filesystem::path(fs_path).parent_path().string();

    nlohmann::json assets = nlohmann::json::array();
    auto list_res = storage_->list_directory(scan_dir, true);
    if (list_res.has_value()) {
        for (const auto& node : list_res.value()) {
            if (node.is_directory) continue;

            // Skip main document file
            std::string lower_node = to_lower_string(node.relative_path);
            if (lower_node == to_lower_string(fs_path) ||
                lower_node == to_lower_string(fs_path + "/index.md")) {
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

Result<std::string> DocumentService::export_bundle_zip(
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

    auto access_res = check_access(user, doc_id, clean_path);
    if (!access_res.has_value() || access_res.value() < db::AccessLevel::Read) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    auto exists_res = storage_->exists(clean_path);
    if (!exists_res.has_value() || !exists_res.value()) {
        return std::unexpected(ErrorCode::NotFound);
    }

    std::vector<ZipFileEntry> entries;
    auto info_res = storage_->get_node_info(clean_path);
    bool is_dir = info_res.has_value() && info_res->is_directory;

    if (!is_dir) {
        auto file_res = storage_->read_file(clean_path);
        if (!file_res.has_value()) {
            return std::unexpected(file_res.error());
        }
        std::filesystem::path fp(clean_path);
        entries.push_back({
            .path_in_zip = fp.filename().string(),
            .data = file_res.value()
        });
    } else {
        auto list_res = storage_->list_directory(clean_path, true);
        if (!list_res.has_value()) {
            return std::unexpected(list_res.error());
        }

        for (const auto& node : list_res.value()) {
            if (node.is_directory) continue;
            auto file_res = storage_->read_file(node.relative_path);
            if (!file_res.has_value()) continue;

            std::string sub_path = node.relative_path;
            if (!clean_path.empty() && sub_path.starts_with(clean_path + "/")) {
                sub_path = sub_path.substr(clean_path.length() + 1);
            }
            entries.push_back({
                .path_in_zip = sub_path,
                .data = file_res.value()
            });
        }
    }

    return create_zip_archive(entries);
}

Result<std::string> DocumentService::export_document_bundle_zip(
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

    return export_bundle_zip(fs_path, user);
}

Result<std::string> DocumentService::import_asset_from_workspace(
    const std::string& doc_id,
    const std::string& source_path,
    const std::string& target_filename,
    const auth::UserIdentity& user
) {
    if (!storage_ || !db_pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    std::string clean_src = normalize_rel_path(source_path);
    if (clean_src.empty() || has_path_traversal(clean_src)) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    // 1. Check Read access to source file
    std::string src_doc_id;
    auto conn_res = db_pool_->acquire();
    if (conn_res.has_value()) {
        try {
            pqxx::read_transaction tx(conn_res->get());
            auto rows = tx.exec_params(
                "SELECT id FROM documents WHERE fs_path = $1;",
                clean_src
            );
            if (!rows.empty()) {
                src_doc_id = rows[0][0].as<std::string>();
            }
        } catch (...) {}
    }

    auto src_access = check_access(user, src_doc_id, clean_src);
    if (!src_access.has_value() || src_access.value() < db::AccessLevel::Read) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    // 2. Read source file content
    auto data_res = storage_->read_file(clean_src);
    if (!data_res.has_value()) {
        return std::unexpected(data_res.error());
    }

    // 3. Resolve target filename
    std::string fn = target_filename;
    if (fn.empty()) {
        std::filesystem::path fp(clean_src);
        fn = fp.filename().string();
    }

    // 4. Upload into bundle via upload_asset (which enforces Edit permission on doc_id)
    return upload_asset(doc_id, fn, data_res.value(), user);
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

        bool is_bundle_node = node.is_bundle && node.relative_path.ends_with(".bundle");
        nlohmann::json item;
        item["name"] = node.name;
        item["path"] = node.relative_path;
        item["is_directory"] = node.is_directory;
        item["is_bundle"] = is_bundle_node;
        item["size_bytes"] = node.size_bytes;

        std::string type = "file";
        if (is_bundle_node) type = "bundle";
        else if (node.is_directory) type = "directory";
        else if (node.name.ends_with(".md") || node.name.ends_with(".markdown")) type = "document";
        item["type"] = type;

        if (doc_metas.contains(node.relative_path) && (!node.is_directory || is_bundle_node)) {
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
            {"access_level", db::to_string(g.access_level)},
            {"is_inheritable", g.is_inheritable}
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
    bool is_inheritable,
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
                "DELETE FROM permissions WHERE target_type = 'DOCUMENT' AND target_id = $1::uuid AND grantee_type = $2 AND grantee_id = $3::uuid",
                target_id,
                grantee_type,
                grantee_id
            );
            tx.exec_params(
                "INSERT INTO permissions (target_type, target_id, grantee_type, grantee_id, access_level, is_inheritable) VALUES ('DOCUMENT', $1::uuid, $2, $3::uuid, $4, $5)",
                target_id,
                grantee_type,
                grantee_id,
                clean_lvl,
                is_inheritable
            );
        } else {
            std::string clean_dir = normalize_rel_path(dir_path);
            tx.exec_params(
                "DELETE FROM permissions WHERE target_type = 'DIRECTORY' AND COALESCE(directory_path, '') = $1 AND grantee_type = $2 AND grantee_id = $3::uuid",
                clean_dir,
                grantee_type,
                grantee_id
            );
            tx.exec_params(
                "INSERT INTO permissions (target_type, directory_path, grantee_type, grantee_id, access_level, is_inheritable) VALUES ('DIRECTORY', $1, $2, $3::uuid, $4, $5)",
                clean_dir,
                grantee_type,
                grantee_id,
                clean_lvl,
                is_inheritable
            );
        }
        tx.commit();
        return get_node_permissions(target_type, target_id, dir_path, user);
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] set_node_permission failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<nlohmann::json> DocumentService::test_node_permission(
    const std::string& target_type,
    const std::string& target_id,
    const std::string& dir_path,
    const std::string& subject_type,
    const std::string& subject_id,
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
    if (!details_res.has_value() || (!details_res.value().can_manage && details_res.value().effective_level == db::AccessLevel::None)) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    std::string fs_path = dir_path;
    if (target_type == "DOCUMENT" && !target_id.empty()) {
        try {
            pqxx::read_transaction rtx(conn_res->get());
            auto row = rtx.exec_params("SELECT fs_path FROM documents WHERE id = $1::uuid;", target_id);
            if (!row.empty() && !row[0][0].is_null()) {
                fs_path = row[0][0].as<std::string>();
            }
        } catch (...) {}
    }

    auto test_res = db::PermissionEngine::test_permission(
        conn_res->get(),
        subject_type,
        subject_id,
        target_type,
        target_id,
        fs_path
    );
    if (!test_res.has_value()) {
        return std::unexpected(test_res.error());
    }

    const auto& t = test_res.value();
    nlohmann::json res = {
        {"target_type", t.target_type},
        {"target_id", t.target_id},
        {"target_path", t.target_path},
        {"subject_type", t.subject_type},
        {"subject_id", t.subject_id},
        {"subject_name", t.subject_name},
        {"effective_level", std::string(db::to_string(t.effective_level))},
        {"is_admin", t.is_system_admin},
        {"is_owner", t.is_owner},
        {"effective_teams", t.effective_teams}
    };

    res["matched_rules"] = nlohmann::json::array();
    for (const auto& r : t.matched_rules) {
        res["matched_rules"].push_back({
            {"source", r.source},
            {"level", std::string(db::to_string(r.level))},
            {"grantee_type", r.grantee_type},
            {"grantee_id", r.grantee_id},
            {"grantee_name", r.grantee_name},
            {"inherited_from", r.inherited_from},
            {"is_inheritable", r.is_inheritable},
            {"description", r.description}
        });
    }

    return res;
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
                WHERE id = $1::uuid
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
                    updated_at = NOW()
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
