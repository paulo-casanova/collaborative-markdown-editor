#include "cme/review/review_service.hpp"
#include <iostream>

namespace cme::review {

namespace {

nlohmann::json parse_json_safe(const std::string& str) {
    if (str.empty()) return nlohmann::json::object();
    try {
        return nlohmann::json::parse(str);
    } catch (...) {
        return nlohmann::json::object();
    }
}

} // namespace

ReviewService::ReviewService(
    std::shared_ptr<db::ConnectionPool> db_pool,
    std::shared_ptr<document::DocumentService> doc_service
) : db_pool_(std::move(db_pool)),
    doc_service_(std::move(doc_service)) {
    if (db_pool_) {
        try {
            auto conn_res = db_pool_->acquire();
            if (conn_res.has_value()) {
                pqxx::work tx(conn_res->get());
                tx.exec(
                    "CREATE TABLE IF NOT EXISTS comment_user_acks ("
                    "    comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,"
                    "    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,"
                    "    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),"
                    "    PRIMARY KEY (comment_id, user_id)"
                    ");"
                    "CREATE INDEX IF NOT EXISTS idx_comment_user_acks_user ON comment_user_acks(user_id);"
                    "CREATE TABLE IF NOT EXISTS suggestion_user_acks ("
                    "    suggestion_id UUID NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,"
                    "    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,"
                    "    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),"
                    "    PRIMARY KEY (suggestion_id, user_id)"
                    ");"
                    "CREATE INDEX IF NOT EXISTS idx_suggestion_user_acks_user ON suggestion_user_acks(user_id);"
                );
                tx.commit();
            }
        } catch (...) {}
    }
}

Result<db::AccessLevel> ReviewService::check_doc_access(
    const std::string& document_id,
    const auth::UserIdentity& user,
    std::string* out_fs_path
) {
    if (!db_pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    std::string fs_path;
    std::string real_doc_id = document_id;
    try {
        pqxx::work tx(conn_res->get());
        if (is_valid_uuid(document_id)) {
            auto rows = tx.exec_params(
                "SELECT fs_path FROM documents WHERE id = $1::uuid;",
                document_id
            );
            if (rows.empty()) {
                return std::unexpected(ErrorCode::NotFound);
            }
            fs_path = rows[0][0].as<std::string>();
        } else {
            auto rows = tx.exec_params(
                "SELECT id, fs_path FROM documents WHERE fs_path = $1;",
                document_id
            );
            if (rows.empty()) {
                return std::unexpected(ErrorCode::NotFound);
            }
            real_doc_id = rows[0][0].as<std::string>();
            fs_path = rows[0][1].as<std::string>();
        }
        if (out_fs_path) {
            *out_fs_path = fs_path;
        }
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::check_doc_access DB query failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }

    if (user.is_system_admin) {
        return db::AccessLevel::Admin;
    }

    return db::PermissionEngine::check_permission(
        conn_res->get(),
        user.user_id,
        real_doc_id,
        fs_path
    );
}

// =============================================================================
// Comments
// =============================================================================

Result<std::vector<CommentRecord>> ReviewService::list_comments(
    const std::string& document_id,
    const auth::UserIdentity& user
) {
    auto access_res = check_doc_access(document_id, user);
    if (!access_res.has_value()) {
        return std::unexpected(access_res.error());
    }
    if (access_res.value() < db::AccessLevel::Read) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    std::vector<CommentRecord> roots;
    std::unordered_map<std::string, std::vector<CommentRecord>> replies_by_parent;

    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT c.id::text, c.document_id::text, c.parent_id::text, c.author_id::text, "
            "       c.content, c.status, c.anchor::text, c.created_at::text, c.updated_at::text, "
            "       u.username, u.display_name, u.avatar_color "
            "FROM comments c "
            "JOIN users u ON c.author_id = u.id "
            "WHERE c.document_id = $1::uuid AND c.status != 'ARCHIVED' "
            "ORDER BY c.created_at ASC;",
            document_id
        );

        for (const auto& row : rows) {
            CommentRecord rec{
                .id = row[0].as<std::string>(),
                .document_id = row[1].as<std::string>(),
                .parent_id = row[2].is_null() ? std::nullopt : std::optional<std::string>(row[2].as<std::string>()),
                .author = AuthorInfo{
                    .id = row[3].as<std::string>(),
                    .username = row[9].as<std::string>(),
                    .display_name = row[10].as<std::string>(),
                    .avatar_color = row[11].as<std::string>()
                },
                .content = row[4].as<std::string>(),
                .status = row[5].as<std::string>(),
                .anchor = parse_json_safe(row[6].as<std::string>()),
                .created_at = row[7].as<std::string>(),
                .updated_at = row[8].as<std::string>(),
                .replies = {}
            };

            if (rec.parent_id.has_value()) {
                replies_by_parent[*rec.parent_id].push_back(std::move(rec));
            } else {
                roots.push_back(std::move(rec));
            }
        }
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::list_comments failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }

    for (auto& root : roots) {
        auto it = replies_by_parent.find(root.id);
        if (it != replies_by_parent.end()) {
            root.replies = std::move(it->second);
        }
    }

    return roots;
}

Result<CommentRecord> ReviewService::get_comment(
    const std::string& comment_id,
    const auth::UserIdentity& user
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    CommentRecord rec;
    std::string doc_id;
    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT c.id::text, c.document_id::text, c.parent_id::text, c.author_id::text, "
            "       c.content, c.status, c.anchor::text, c.created_at::text, c.updated_at::text, "
            "       u.username, u.display_name, u.avatar_color "
            "FROM comments c "
            "JOIN users u ON c.author_id = u.id "
            "WHERE c.id = $1::uuid;",
            comment_id
        );
        if (rows.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }
        const auto& row = rows[0];
        doc_id = row[1].as<std::string>();
        rec = CommentRecord{
            .id = row[0].as<std::string>(),
            .document_id = doc_id,
            .parent_id = row[2].is_null() ? std::nullopt : std::optional<std::string>(row[2].as<std::string>()),
            .author = AuthorInfo{
                .id = row[3].as<std::string>(),
                .username = row[9].as<std::string>(),
                .display_name = row[10].as<std::string>(),
                .avatar_color = row[11].as<std::string>()
            },
            .content = row[4].as<std::string>(),
            .status = row[5].as<std::string>(),
            .anchor = parse_json_safe(row[6].as<std::string>()),
            .created_at = row[7].as<std::string>(),
            .updated_at = row[8].as<std::string>(),
            .replies = {}
        };

        // Query replies if this is a root comment
        if (!rec.parent_id.has_value()) {
            auto rep_rows = tx.exec_params(
                "SELECT c.id::text, c.document_id::text, c.parent_id::text, c.author_id::text, "
                "       c.content, c.status, c.anchor::text, c.created_at::text, c.updated_at::text, "
                "       u.username, u.display_name, u.avatar_color "
                "FROM comments c "
                "JOIN users u ON c.author_id = u.id "
                "WHERE c.parent_id = $1::uuid "
                "ORDER BY c.created_at ASC;",
                comment_id
            );
            for (const auto& r : rep_rows) {
                rec.replies.push_back(CommentRecord{
                    .id = r[0].as<std::string>(),
                    .document_id = r[1].as<std::string>(),
                    .parent_id = comment_id,
                    .author = AuthorInfo{
                        .id = r[3].as<std::string>(),
                        .username = r[9].as<std::string>(),
                        .display_name = r[10].as<std::string>(),
                        .avatar_color = r[11].as<std::string>()
                    },
                    .content = r[4].as<std::string>(),
                    .status = r[5].as<std::string>(),
                    .anchor = parse_json_safe(r[6].as<std::string>()),
                    .created_at = r[7].as<std::string>(),
                    .updated_at = r[8].as<std::string>(),
                    .replies = {}
                });
            }
        }
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::get_comment failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto access_res = check_doc_access(doc_id, user);
    if (!access_res.has_value()) return std::unexpected(access_res.error());
    if (access_res.value() < db::AccessLevel::Read) return std::unexpected(ErrorCode::PermissionDenied);

    return rec;
}

Result<CommentRecord> ReviewService::create_comment(
    const std::string& document_id,
    const auth::UserIdentity& user,
    const CreateCommentRequest& req
) {
    if (req.content.empty()) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    auto access_res = check_doc_access(document_id, user);
    if (!access_res.has_value()) return std::unexpected(access_res.error());
    if (access_res.value() < db::AccessLevel::Comment) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        std::string anchor_str = req.anchor.is_null() ? "{}" : req.anchor.dump();
        auto rows = tx.exec_params(
            "INSERT INTO comments (document_id, author_id, content, anchor) "
            "VALUES ($1::uuid, $2::uuid, $3, $4::jsonb) "
            "RETURNING id::text, created_at::text, updated_at::text;",
            document_id, user.user_id, req.content, anchor_str
        );
        tx.commit();

        if (rows.empty()) return std::unexpected(ErrorCode::DatabaseError);

        return CommentRecord{
            .id = rows[0][0].as<std::string>(),
            .document_id = document_id,
            .parent_id = std::nullopt,
            .author = AuthorInfo{
                .id = user.user_id,
                .username = user.username,
                .display_name = user.display_name.empty() ? user.username : user.display_name,
                .avatar_color = user.avatar_color.empty() ? "#3b82f6" : user.avatar_color
            },
            .content = req.content,
            .status = "OPEN",
            .anchor = req.anchor,
            .created_at = rows[0][1].as<std::string>(),
            .updated_at = rows[0][2].as<std::string>(),
            .replies = {}
        };
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::create_comment failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<CommentRecord> ReviewService::reply_comment(
    const std::string& comment_id,
    const auth::UserIdentity& user,
    const std::string& content
) {
    if (content.empty()) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    std::string doc_id;
    try {
        pqxx::work tx(conn_res->get());
        auto parent_rows = tx.exec_params(
            "SELECT document_id::text FROM comments WHERE id = $1::uuid;",
            comment_id
        );
        if (parent_rows.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }
        doc_id = parent_rows[0][0].as<std::string>();
    } catch (const std::exception& e) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto access_res = check_doc_access(doc_id, user);
    if (!access_res.has_value()) return std::unexpected(access_res.error());
    if (access_res.value() < db::AccessLevel::Comment) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "INSERT INTO comments (document_id, parent_id, author_id, content) "
            "VALUES ($1::uuid, $2::uuid, $3::uuid, $4) "
            "RETURNING id::text, created_at::text, updated_at::text;",
            doc_id, comment_id, user.user_id, content
        );
        tx.commit();

        if (rows.empty()) return std::unexpected(ErrorCode::DatabaseError);

        return CommentRecord{
            .id = rows[0][0].as<std::string>(),
            .document_id = doc_id,
            .parent_id = comment_id,
            .author = AuthorInfo{
                .id = user.user_id,
                .username = user.username,
                .display_name = user.display_name.empty() ? user.username : user.display_name,
                .avatar_color = user.avatar_color.empty() ? "#3b82f6" : user.avatar_color
            },
            .content = content,
            .status = "OPEN",
            .anchor = nlohmann::json::object(),
            .created_at = rows[0][1].as<std::string>(),
            .updated_at = rows[0][2].as<std::string>(),
            .replies = {}
        };
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::reply_comment failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<CommentRecord> ReviewService::update_comment_content(
    const std::string& comment_id,
    const auth::UserIdentity& user,
    const std::string& content
) {
    if (content.empty()) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    std::string doc_id;
    std::string author_id;
    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT document_id::text, author_id::text FROM comments WHERE id = $1::uuid;",
            comment_id
        );
        if (rows.empty()) return std::unexpected(ErrorCode::NotFound);
        doc_id = rows[0][0].as<std::string>();
        author_id = rows[0][1].as<std::string>();
    } catch (...) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto access_res = check_doc_access(doc_id, user);
    if (!access_res.has_value()) return std::unexpected(access_res.error());
    if (access_res.value() < db::AccessLevel::Comment) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }
    if (user.user_id != author_id && access_res.value() < db::AccessLevel::Edit && !user.is_system_admin) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "UPDATE comments "
            "SET content = $1, updated_at = NOW() "
            "WHERE id = $2::uuid "
            "RETURNING id::text;",
            content, comment_id
        );
        tx.commit();

        if (rows.empty()) return std::unexpected(ErrorCode::NotFound);

        return get_comment(comment_id, user);
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::update_comment_content failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<CommentRecord> ReviewService::update_comment_status(
    const std::string& comment_id,
    const auth::UserIdentity& user,
    const std::string& status
) {
    if (status != "OPEN" && status != "RESOLVED" && status != "ARCHIVED") {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    std::string doc_id;
    std::string author_id;
    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT document_id::text, author_id::text FROM comments WHERE id = $1::uuid;",
            comment_id
        );
        if (rows.empty()) return std::unexpected(ErrorCode::NotFound);
        doc_id = rows[0][0].as<std::string>();
        author_id = rows[0][1].as<std::string>();
    } catch (...) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto access_res = check_doc_access(doc_id, user);
    if (!access_res.has_value()) return std::unexpected(access_res.error());
    if (access_res.value() < db::AccessLevel::Edit && user.user_id != author_id && !user.is_system_admin) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "UPDATE comments "
            "SET status = $1, updated_at = NOW() "
            "WHERE id = $2::uuid "
            "RETURNING parent_id::text, content, anchor::text, created_at::text, updated_at::text;",
            status, comment_id
        );
        tx.commit();

        if (rows.empty()) return std::unexpected(ErrorCode::NotFound);

        return get_comment(comment_id, user);
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::update_comment_status failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<CommentRecord> ReviewService::archive_comment(
    const std::string& comment_id,
    const auth::UserIdentity& user
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    std::string doc_id;
    std::string author_id;
    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT document_id::text, author_id::text FROM comments WHERE id = $1::uuid;",
            comment_id
        );
        if (rows.empty()) return std::unexpected(ErrorCode::NotFound);
        doc_id = rows[0][0].as<std::string>();
        author_id = rows[0][1].as<std::string>();
    } catch (...) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto access_res = check_doc_access(doc_id, user);
    if (!access_res.has_value()) return std::unexpected(access_res.error());
    if (access_res.value() < db::AccessLevel::Edit && user.user_id != author_id && !user.is_system_admin) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "UPDATE comments "
            "SET status = 'ARCHIVED', updated_at = NOW() "
            "WHERE id = $1::uuid "
            "RETURNING id::text;",
            comment_id
        );
        tx.commit();

        if (rows.empty()) return std::unexpected(ErrorCode::NotFound);

        return get_comment(comment_id, user);
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::archive_comment failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<void> ReviewService::delete_comment(
    const std::string& comment_id,
    const auth::UserIdentity& user
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    std::string doc_id;
    std::string author_id;
    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT document_id::text, author_id::text FROM comments WHERE id = $1::uuid;",
            comment_id
        );
        if (rows.empty()) return std::unexpected(ErrorCode::NotFound);
        doc_id = rows[0][0].as<std::string>();
        author_id = rows[0][1].as<std::string>();
    } catch (...) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto access_res = check_doc_access(doc_id, user);
    if (!access_res.has_value()) return std::unexpected(access_res.error());
    if (access_res.value() < db::AccessLevel::Edit && user.user_id != author_id && !user.is_system_admin) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    try {
        pqxx::work tx(conn_res->get());
        tx.exec_params("DELETE FROM comments WHERE id = $1::uuid;", comment_id);
        tx.commit();
        return {};
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::delete_comment failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<std::vector<CommentRecord>> ReviewService::list_participated_comments(
    const auth::UserIdentity& user,
    const std::string& status_filter
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    std::vector<CommentRecord> list;
    try {
        pqxx::work tx(conn_res->get());
        std::string q =
            "SELECT c.id::text, c.document_id::text, c.author_id::text, c.content, c.status, "
            "       c.anchor::text, c.created_at::text, c.updated_at::text, "
            "       u.username, u.display_name, u.avatar_color, "
            "       COALESCE(d.title, 'Untitled Document'), COALESCE(d.fs_path, ''), "
            "       GREATEST(c.created_at, c.updated_at, COALESCE((SELECT MAX(r.created_at) FROM comments r WHERE r.parent_id = c.id), c.created_at))::text AS last_activity, "
            "       ack.acknowledged_at::text, "
            "       (ack.acknowledged_at IS NOT NULL) AS is_ack "
            "FROM comments c "
            "JOIN documents d ON c.document_id = d.id "
            "JOIN users u ON c.author_id = u.id "
            "LEFT JOIN comment_user_acks ack ON ack.comment_id = c.id AND ack.user_id = " + tx.quote(user.user_id) + "::uuid "
            "WHERE c.parent_id IS NULL "
            "  AND c.status != 'ARCHIVED' "
            "  AND ( "
            "      c.author_id = " + tx.quote(user.user_id) + "::uuid "
            "      OR EXISTS (SELECT 1 FROM comments r WHERE r.parent_id = c.id AND r.author_id = " + tx.quote(user.user_id) + "::uuid) "
            "  ) ";

        if (status_filter == "open") {
            q += "AND c.status = 'OPEN' ";
        } else if (status_filter == "resolved" || status_filter == "closed") {
            q += "AND c.status = 'RESOLVED' ";
        } else if (status_filter == "acknowledged") {
            q += "AND ack.acknowledged_at IS NOT NULL ";
        } else if (status_filter == "all") {
            // no extra filter
        } else {
            // "active" (default): open threads OR closed threads that are NOT yet ACKed by this user
            q += "AND (c.status = 'OPEN' OR (c.status = 'RESOLVED' AND ack.acknowledged_at IS NULL)) ";
        }

        q += "ORDER BY last_activity DESC;";

        auto rows = tx.exec(q);
        std::vector<std::string> parent_ids;
        for (const auto& row : rows) {
            std::string comment_id = row[0].as<std::string>();
            parent_ids.push_back(comment_id);

            list.push_back(CommentRecord{
                .id = comment_id,
                .document_id = row[1].as<std::string>(),
                .document_title = row[11].as<std::string>(),
                .document_path = row[12].as<std::string>(),
                .parent_id = std::nullopt,
                .author = AuthorInfo{
                    .id = row[2].as<std::string>(),
                    .username = row[8].as<std::string>(),
                    .display_name = row[9].as<std::string>(),
                    .avatar_color = row[10].as<std::string>()
                },
                .content = row[3].as<std::string>(),
                .status = row[4].as<std::string>(),
                .anchor = parse_json_safe(row[5].as<std::string>()),
                .created_at = row[6].as<std::string>(),
                .updated_at = row[7].as<std::string>(),
                .last_activity_at = row[13].as<std::string>(),
                .is_acknowledged = row[15].as<bool>(),
                .acknowledged_at = row[14].is_null() ? std::nullopt : std::optional<std::string>(row[14].as<std::string>()),
                .replies = {}
            });
        }

        if (!parent_ids.empty()) {
            std::string parent_in;
            for (size_t i = 0; i < parent_ids.size(); ++i) {
                if (i > 0) parent_in += ", ";
                parent_in += tx.quote(parent_ids[i]) + "::uuid";
            }
            auto reply_rows = tx.exec(
                "SELECT r.id::text, r.document_id::text, r.parent_id::text, r.author_id::text, "
                "       r.content, r.status, r.anchor::text, r.created_at::text, r.updated_at::text, "
                "       u.username, u.display_name, u.avatar_color "
                "FROM comments r "
                "JOIN users u ON r.author_id = u.id "
                "WHERE r.parent_id IN (" + parent_in + ") "
                "  AND r.status != 'ARCHIVED' "
                "ORDER BY r.created_at ASC;"
            );

            std::unordered_map<std::string, std::vector<CommentRecord>> replies_map;
            for (const auto& rrow : reply_rows) {
                std::string p_id = rrow[2].as<std::string>();
                replies_map[p_id].push_back(CommentRecord{
                    .id = rrow[0].as<std::string>(),
                    .document_id = rrow[1].as<std::string>(),
                    .document_title = "",
                    .document_path = "",
                    .parent_id = p_id,
                    .author = AuthorInfo{
                        .id = rrow[3].as<std::string>(),
                        .username = rrow[9].as<std::string>(),
                        .display_name = rrow[10].as<std::string>(),
                        .avatar_color = rrow[11].as<std::string>()
                    },
                    .content = rrow[4].as<std::string>(),
                    .status = rrow[5].as<std::string>(),
                    .anchor = parse_json_safe(rrow[6].as<std::string>()),
                    .created_at = rrow[7].as<std::string>(),
                    .updated_at = rrow[8].as<std::string>(),
                    .last_activity_at = rrow[7].as<std::string>(),
                    .is_acknowledged = false,
                    .acknowledged_at = std::nullopt,
                    .replies = {}
                });
            }

            for (auto& item : list) {
                auto it = replies_map.find(item.id);
                if (it != replies_map.end()) {
                    item.replies = std::move(it->second);
                }
            }
        }
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::list_participated_comments failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }

    return list;
}

Result<void> ReviewService::acknowledge_comment(
    const std::string& comment_id,
    const auth::UserIdentity& user
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        auto chk = tx.exec_params("SELECT id FROM comments WHERE id = $1::uuid;", comment_id);
        if (chk.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }

        tx.exec_params(
            "INSERT INTO comment_user_acks (comment_id, user_id, acknowledged_at) "
            "VALUES ($1::uuid, $2::uuid, NOW()) "
            "ON CONFLICT (comment_id, user_id) DO UPDATE SET acknowledged_at = NOW();",
            comment_id, user.user_id
        );
        tx.commit();
        return {};
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::acknowledge_comment failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<int64_t> ReviewService::acknowledge_all_comments(
    const auth::UserIdentity& user
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        auto res = tx.exec_params(
            "INSERT INTO comment_user_acks (comment_id, user_id, acknowledged_at) "
            "SELECT c.id, $1::uuid, NOW() "
            "FROM comments c "
            "WHERE c.parent_id IS NULL "
            "  AND c.status = 'RESOLVED' "
            "  AND ( "
            "      c.author_id = $1::uuid "
            "      OR EXISTS (SELECT 1 FROM comments r WHERE r.parent_id = c.id AND r.author_id = $1::uuid) "
            "  ) "
            "ON CONFLICT (comment_id, user_id) DO UPDATE SET acknowledged_at = NOW();",
            user.user_id
        );
        tx.commit();
        return res.affected_rows();
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::acknowledge_all_comments failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<int64_t> ReviewService::get_unacknowledged_comments_count(
    const auth::UserIdentity& user
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        auto res = tx.exec_params(
            "SELECT COUNT(*) "
            "FROM comments c "
            "LEFT JOIN comment_user_acks ack ON ack.comment_id = c.id AND ack.user_id = $1::uuid "
            "WHERE c.parent_id IS NULL "
            "  AND c.status = 'RESOLVED' "
            "  AND ack.acknowledged_at IS NULL "
            "  AND ( "
            "      c.author_id = $1::uuid "
            "      OR EXISTS (SELECT 1 FROM comments r WHERE r.parent_id = c.id AND r.author_id = $1::uuid) "
            "  );",
            user.user_id
        );
        return res[0][0].as<int64_t>();
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::get_unacknowledged_comments_count failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

// =============================================================================
// Suggestions
// =============================================================================

Result<std::vector<SuggestionRecord>> ReviewService::list_suggestions(
    const std::string& document_id,
    const auth::UserIdentity& user,
    const std::string& status_filter
) {
    auto access_res = check_doc_access(document_id, user);
    if (!access_res.has_value()) return std::unexpected(access_res.error());
    if (access_res.value() < db::AccessLevel::Read) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    std::vector<SuggestionRecord> list;
    try {
        pqxx::work tx(conn_res->get());
        pqxx::result rows;
        if (status_filter.empty()) {
            rows = tx.exec_params(
                "SELECT s.id::text, s.document_id::text, s.author_id::text, s.status, "
                "       s.original_text, s.suggested_text, s.anchor::text, "
                "       s.created_at::text, s.resolved_at::text, "
                "       u.username, u.display_name, u.avatar_color "
                "FROM suggestions s "
                "JOIN users u ON s.author_id = u.id "
                "WHERE s.document_id = $1::uuid AND s.status != 'ARCHIVED' "
                "ORDER BY s.created_at ASC;",
                document_id
            );
        } else {
            rows = tx.exec_params(
                "SELECT s.id::text, s.document_id::text, s.author_id::text, s.status, "
                "       s.original_text, s.suggested_text, s.anchor::text, "
                "       s.created_at::text, s.resolved_at::text, "
                "       u.username, u.display_name, u.avatar_color "
                "FROM suggestions s "
                "JOIN users u ON s.author_id = u.id "
                "WHERE s.document_id = $1::uuid AND s.status = $2 "
                "ORDER BY s.created_at ASC;",
                document_id, status_filter
            );
        }

        for (const auto& row : rows) {
            list.push_back(SuggestionRecord{
                .id = row[0].as<std::string>(),
                .document_id = row[1].as<std::string>(),
                .author = AuthorInfo{
                    .id = row[2].as<std::string>(),
                    .username = row[9].as<std::string>(),
                    .display_name = row[10].as<std::string>(),
                    .avatar_color = row[11].as<std::string>()
                },
                .status = row[3].as<std::string>(),
                .original_text = row[4].as<std::string>(),
                .suggested_text = row[5].as<std::string>(),
                .anchor = parse_json_safe(row[6].as<std::string>()),
                .created_at = row[7].as<std::string>(),
                .resolved_at = row[8].is_null() ? std::nullopt : std::optional<std::string>(row[8].as<std::string>())
            });
        }
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::list_suggestions failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }

    return list;
}

Result<SuggestionRecord> ReviewService::get_suggestion(
    const std::string& suggestion_id,
    const auth::UserIdentity& user
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    SuggestionRecord rec;
    std::string doc_id;
    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT s.id::text, s.document_id::text, s.author_id::text, s.status, "
            "       s.original_text, s.suggested_text, s.anchor::text, "
            "       s.created_at::text, s.resolved_at::text, "
            "       u.username, u.display_name, u.avatar_color "
            "FROM suggestions s "
            "JOIN users u ON s.author_id = u.id "
            "WHERE s.id = $1::uuid;",
            suggestion_id
        );
        if (rows.empty()) return std::unexpected(ErrorCode::NotFound);

        const auto& row = rows[0];
        doc_id = row[1].as<std::string>();
        rec = SuggestionRecord{
            .id = row[0].as<std::string>(),
            .document_id = doc_id,
            .author = AuthorInfo{
                .id = row[2].as<std::string>(),
                .username = row[9].as<std::string>(),
                .display_name = row[10].as<std::string>(),
                .avatar_color = row[11].as<std::string>()
            },
            .status = row[3].as<std::string>(),
            .original_text = row[4].as<std::string>(),
            .suggested_text = row[5].as<std::string>(),
            .anchor = parse_json_safe(row[6].as<std::string>()),
            .created_at = row[7].as<std::string>(),
            .resolved_at = row[8].is_null() ? std::nullopt : std::optional<std::string>(row[8].as<std::string>())
        };
    } catch (...) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto access_res = check_doc_access(doc_id, user);
    if (!access_res.has_value()) return std::unexpected(access_res.error());
    if (access_res.value() < db::AccessLevel::Read) return std::unexpected(ErrorCode::PermissionDenied);

    return rec;
}

Result<SuggestionRecord> ReviewService::create_suggestion(
    const std::string& document_id,
    const auth::UserIdentity& user,
    const CreateSuggestionRequest& req
) {
    auto access_res = check_doc_access(document_id, user);
    if (!access_res.has_value()) return std::unexpected(access_res.error());
    if (access_res.value() < db::AccessLevel::Comment) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        std::string anchor_str = req.anchor.is_null() ? "{}" : req.anchor.dump();
        auto rows = tx.exec_params(
            "INSERT INTO suggestions (document_id, author_id, original_text, suggested_text, anchor) "
            "VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb) "
            "RETURNING id::text, created_at::text;",
            document_id, user.user_id, req.original_text, req.suggested_text, anchor_str
        );
        tx.commit();

        if (rows.empty()) return std::unexpected(ErrorCode::DatabaseError);

        return SuggestionRecord{
            .id = rows[0][0].as<std::string>(),
            .document_id = document_id,
            .author = AuthorInfo{
                .id = user.user_id,
                .username = user.username,
                .display_name = user.display_name.empty() ? user.username : user.display_name,
                .avatar_color = user.avatar_color.empty() ? "#3b82f6" : user.avatar_color
            },
            .status = "PENDING",
            .original_text = req.original_text,
            .suggested_text = req.suggested_text,
            .anchor = req.anchor,
            .created_at = rows[0][1].as<std::string>(),
            .resolved_at = std::nullopt
        };
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::create_suggestion failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<SuggestionRecord> ReviewService::accept_suggestion(
    const std::string& suggestion_id,
    const auth::UserIdentity& user,
    std::shared_ptr<collab::RoomManager> room_manager,
    std::function<void(const std::string& doc_id, std::span<const uint8_t> delta)> broadcast_sync_cb
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    SuggestionRecord rec;
    std::string doc_id;
    std::string fs_path;
    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT s.id::text, s.document_id::text, s.author_id::text, s.status, "
            "       s.original_text, s.suggested_text, s.anchor::text, "
            "       s.created_at::text, u.username, u.display_name, u.avatar_color, d.fs_path "
            "FROM suggestions s "
            "JOIN users u ON s.author_id = u.id "
            "JOIN documents d ON s.document_id = d.id "
            "WHERE s.id = $1::uuid;",
            suggestion_id
        );
        if (rows.empty()) return std::unexpected(ErrorCode::NotFound);
        const auto& row = rows[0];
        doc_id = row[1].as<std::string>();
        fs_path = row[11].as<std::string>();

        if (row[3].as<std::string>() != "PENDING") {
            return std::unexpected(ErrorCode::InvalidArgument);
        }

        rec = SuggestionRecord{
            .id = row[0].as<std::string>(),
            .document_id = doc_id,
            .author = AuthorInfo{
                .id = row[2].as<std::string>(),
                .username = row[8].as<std::string>(),
                .display_name = row[9].as<std::string>(),
                .avatar_color = row[10].as<std::string>()
            },
            .status = "ACCEPTED",
            .original_text = row[4].as<std::string>(),
            .suggested_text = row[5].as<std::string>(),
            .anchor = parse_json_safe(row[6].as<std::string>()),
            .created_at = row[7].as<std::string>(),
            .resolved_at = std::nullopt
        };
    } catch (...) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto access_res = check_doc_access(doc_id, user);
    if (!access_res.has_value()) return std::unexpected(access_res.error());
    if (access_res.value() < db::AccessLevel::Edit) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    // Apply live CRDT edit to DocumentRoom
    if (room_manager) {
        auto room = room_manager->get_room(doc_id);
        if (!room && doc_service_) {
            auto d = doc_service_->get_document_by_id(doc_id, user);
            if (d.has_value()) {
                std::vector<uint8_t> crdt_state;
                if (doc_service_->storage()) {
                    auto crdt_res = doc_service_->storage()->load_crdt_state(doc_id);
                    if (crdt_res.has_value()) {
                        crdt_state = std::move(*crdt_res);
                    }
                }
                room = room_manager->get_or_create_room(doc_id, d->content, d->path, crdt_state);
            }
        }

        if (room) {
            std::string content = room->get_content();
            uint32_t offset = 0;
            uint32_t len = static_cast<uint32_t>(rec.original_text.size());
            bool located = false;

            if (rec.anchor.contains("offset") && rec.anchor["offset"].is_number_integer()) {
                offset = rec.anchor["offset"].get<uint32_t>();
                if (rec.anchor.contains("length") && rec.anchor["length"].is_number_integer()) {
                    len = rec.anchor["length"].get<uint32_t>();
                }
                if (offset + len <= content.size() && content.substr(offset, len) == rec.original_text) {
                    located = true;
                }
            }

            // Strategy B quote fallback
            if (!located && rec.anchor.contains("quote") && rec.anchor["quote"].is_object()) {
                const auto& q = rec.anchor["quote"];
                std::string exact = q.value("exact", "");
                std::string prefix = q.value("prefix", "");
                std::string suffix = q.value("suffix", "");
                if (!exact.empty()) {
                    if (!prefix.empty() && !suffix.empty()) {
                        std::string full_pattern = prefix + exact + suffix;
                        size_t p = content.find(full_pattern);
                        if (p != std::string::npos) {
                            offset = static_cast<uint32_t>(p + prefix.size());
                            len = static_cast<uint32_t>(exact.size());
                            located = true;
                        }
                    }
                    if (!located && !prefix.empty()) {
                        std::string pre_pattern = prefix + exact;
                        size_t p = content.find(pre_pattern);
                        if (p != std::string::npos) {
                            offset = static_cast<uint32_t>(p + prefix.size());
                            len = static_cast<uint32_t>(exact.size());
                            located = true;
                        }
                    }
                    if (!located && !suffix.empty()) {
                        std::string post_pattern = exact + suffix;
                        size_t p = content.find(post_pattern);
                        if (p != std::string::npos) {
                            offset = static_cast<uint32_t>(p);
                            len = static_cast<uint32_t>(exact.size());
                            located = true;
                        }
                    }
                    if (!located) {
                        size_t p = content.find(exact);
                        if (p != std::string::npos) {
                            offset = static_cast<uint32_t>(p);
                            len = static_cast<uint32_t>(exact.size());
                            located = true;
                        }
                    }
                }
            }

            if (!located && !rec.original_text.empty()) {
                size_t pos = content.find(rec.original_text);
                if (pos != std::string::npos) {
                    offset = static_cast<uint32_t>(pos);
                    len = static_cast<uint32_t>(rec.original_text.size());
                    located = true;
                }
            }

            if (located || rec.original_text.empty()) {
                if (len > 0) {
                    room->delete_text(offset, len);
                }
                if (!rec.suggested_text.empty()) {
                    room->insert_text(offset, rec.suggested_text);
                }
                if (broadcast_sync_cb) {
                    std::vector<uint8_t> empty_sv = {0};
                    auto delta = room->compute_sync_step2(empty_sv);
                    if (!delta.empty()) {
                        broadcast_sync_cb(doc_id, delta);
                    }
                }
            }
        }
    }

    try {
        pqxx::work tx(conn_res->get());
        auto update_rows = tx.exec_params(
            "UPDATE suggestions "
            "SET status = 'ACCEPTED', resolved_at = NOW() "
            "WHERE id = $1::uuid "
            "RETURNING resolved_at::text;",
            suggestion_id
        );
        tx.commit();
        if (!update_rows.empty()) {
            rec.resolved_at = update_rows[0][0].as<std::string>();
        }
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::accept_suggestion DB update failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }

    return rec;
}

Result<SuggestionRecord> ReviewService::reject_suggestion(
    const std::string& suggestion_id,
    const auth::UserIdentity& user
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    SuggestionRecord rec;
    std::string doc_id;
    std::string author_id;
    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT s.id::text, s.document_id::text, s.author_id::text, s.status, "
            "       s.original_text, s.suggested_text, s.anchor::text, "
            "       s.created_at::text, u.username, u.display_name, u.avatar_color "
            "FROM suggestions s "
            "JOIN users u ON s.author_id = u.id "
            "WHERE s.id = $1::uuid;",
            suggestion_id
        );
        if (rows.empty()) return std::unexpected(ErrorCode::NotFound);
        const auto& row = rows[0];
        doc_id = row[1].as<std::string>();
        author_id = row[2].as<std::string>();

        if (row[3].as<std::string>() != "PENDING") {
            return std::unexpected(ErrorCode::InvalidArgument);
        }

        rec = SuggestionRecord{
            .id = row[0].as<std::string>(),
            .document_id = doc_id,
            .author = AuthorInfo{
                .id = author_id,
                .username = row[8].as<std::string>(),
                .display_name = row[9].as<std::string>(),
                .avatar_color = row[10].as<std::string>()
            },
            .status = "REJECTED",
            .original_text = row[4].as<std::string>(),
            .suggested_text = row[5].as<std::string>(),
            .anchor = parse_json_safe(row[6].as<std::string>()),
            .created_at = row[7].as<std::string>(),
            .resolved_at = std::nullopt
        };
    } catch (...) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto access_res = check_doc_access(doc_id, user);
    if (!access_res.has_value()) return std::unexpected(access_res.error());
    if (access_res.value() < db::AccessLevel::Edit && user.user_id != author_id && !user.is_system_admin) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    try {
        pqxx::work tx(conn_res->get());
        auto update_rows = tx.exec_params(
            "UPDATE suggestions "
            "SET status = 'REJECTED', resolved_at = NOW() "
            "WHERE id = $1::uuid "
            "RETURNING resolved_at::text;",
            suggestion_id
        );
        tx.commit();
        if (!update_rows.empty()) {
            rec.resolved_at = update_rows[0][0].as<std::string>();
        }
    } catch (const std::exception& e) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    return rec;
}

Result<SuggestionRecord> ReviewService::archive_suggestion(
    const std::string& suggestion_id,
    const auth::UserIdentity& user
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    std::string doc_id;
    std::string author_id;
    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT s.id::text, s.document_id::text, s.author_id::text FROM suggestions s WHERE s.id = $1::uuid;",
            suggestion_id
        );
        if (rows.empty()) return std::unexpected(ErrorCode::NotFound);
        doc_id = rows[0][1].as<std::string>();
        author_id = rows[0][2].as<std::string>();
    } catch (...) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto access_res = check_doc_access(doc_id, user);
    if (!access_res.has_value()) return std::unexpected(access_res.error());
    if (access_res.value() < db::AccessLevel::Edit && user.user_id != author_id && !user.is_system_admin) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    try {
        pqxx::work tx(conn_res->get());
        auto update_rows = tx.exec_params(
            "UPDATE suggestions "
            "SET status = 'ARCHIVED', resolved_at = COALESCE(resolved_at, NOW()) "
            "WHERE id = $1::uuid "
            "RETURNING id::text;",
            suggestion_id
        );
        tx.commit();
        if (update_rows.empty()) return std::unexpected(ErrorCode::NotFound);
        return get_suggestion(suggestion_id, user);
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::archive_suggestion failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<std::vector<SuggestionRecord>> ReviewService::list_all_suggestions(
    const auth::UserIdentity& user,
    const std::string& status_filter
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    std::vector<SuggestionRecord> list;
    try {
        pqxx::work tx(conn_res->get());
        std::string q =
            "SELECT s.id::text, s.document_id::text, s.author_id::text, s.status, "
            "       s.original_text, s.suggested_text, s.anchor::text, "
            "       s.created_at::text, s.resolved_at::text, "
            "       u.username, u.display_name, u.avatar_color, "
            "       COALESCE(d.title, 'Untitled Document'), COALESCE(d.fs_path, ''), "
            "       ack.acknowledged_at::text, "
            "       (ack.acknowledged_at IS NOT NULL) AS is_ack "
            "FROM suggestions s "
            "JOIN documents d ON s.document_id = d.id "
            "JOIN users u ON s.author_id = u.id "
            "LEFT JOIN suggestion_user_acks ack ON ack.suggestion_id = s.id AND ack.user_id = " + tx.quote(user.user_id) + "::uuid "
            "WHERE s.status != 'ARCHIVED' ";

        if (status_filter == "pending") {
            q += "AND s.status = 'PENDING' ";
        } else if (status_filter == "accepted") {
            q += "AND s.status = 'ACCEPTED' ";
        } else if (status_filter == "rejected") {
            q += "AND s.status = 'REJECTED' ";
        } else if (status_filter == "acknowledged") {
            q += "AND ack.acknowledged_at IS NOT NULL ";
        } else if (status_filter == "all") {
            // no extra filter
        } else {
            // "active" (default): pending suggestions OR (accepted/rejected suggestions that are NOT yet ACKed by this user)
            q += "AND (s.status = 'PENDING' OR (s.status IN ('ACCEPTED', 'REJECTED') AND ack.acknowledged_at IS NULL)) ";
        }

        q += "ORDER BY s.created_at DESC;";

        auto rows = tx.exec(q);
        for (const auto& row : rows) {
            list.push_back(SuggestionRecord{
                .id = row[0].as<std::string>(),
                .document_id = row[1].as<std::string>(),
                .document_title = row[12].as<std::string>(),
                .document_path = row[13].as<std::string>(),
                .author = AuthorInfo{
                    .id = row[2].as<std::string>(),
                    .username = row[9].as<std::string>(),
                    .display_name = row[10].as<std::string>(),
                    .avatar_color = row[11].as<std::string>()
                },
                .status = row[3].as<std::string>(),
                .original_text = row[4].as<std::string>(),
                .suggested_text = row[5].as<std::string>(),
                .anchor = parse_json_safe(row[6].as<std::string>()),
                .created_at = row[7].as<std::string>(),
                .resolved_at = row[8].is_null() ? std::nullopt : std::optional<std::string>(row[8].as<std::string>()),
                .is_acknowledged = row[15].as<bool>(),
                .acknowledged_at = row[14].is_null() ? std::nullopt : std::optional<std::string>(row[14].as<std::string>())
            });
        }
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::list_all_suggestions failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }

    return list;
}

Result<void> ReviewService::acknowledge_suggestion(
    const std::string& suggestion_id,
    const auth::UserIdentity& user
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        auto chk = tx.exec_params("SELECT id FROM suggestions WHERE id = $1::uuid;", suggestion_id);
        if (chk.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }

        tx.exec_params(
            "INSERT INTO suggestion_user_acks (suggestion_id, user_id, acknowledged_at) "
            "VALUES ($1::uuid, $2::uuid, NOW()) "
            "ON CONFLICT (suggestion_id, user_id) DO UPDATE SET acknowledged_at = NOW();",
            suggestion_id, user.user_id
        );
        tx.commit();
        return {};
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::acknowledge_suggestion failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<int64_t> ReviewService::acknowledge_all_suggestions(
    const auth::UserIdentity& user
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        auto res = tx.exec_params(
            "INSERT INTO suggestion_user_acks (suggestion_id, user_id, acknowledged_at) "
            "SELECT s.id, $1::uuid, NOW() "
            "FROM suggestions s "
            "WHERE s.status IN ('ACCEPTED', 'REJECTED') "
            "ON CONFLICT (suggestion_id, user_id) DO UPDATE SET acknowledged_at = NOW();",
            user.user_id
        );
        tx.commit();
        return res.affected_rows();
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::acknowledge_all_suggestions failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<int64_t> ReviewService::get_unacknowledged_suggestions_count(
    const auth::UserIdentity& user
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        auto res = tx.exec_params(
            "SELECT COUNT(*) "
            "FROM suggestions s "
            "LEFT JOIN suggestion_user_acks ack ON ack.suggestion_id = s.id AND ack.user_id = $1::uuid "
            "WHERE s.status IN ('ACCEPTED', 'REJECTED') "
            "  AND ack.acknowledged_at IS NULL;",
            user.user_id
        );
        return res[0][0].as<int64_t>();
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::get_unacknowledged_suggestions_count failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

// =============================================================================
// Tasks
// =============================================================================

Result<std::vector<TaskRecord>> ReviewService::list_tasks(
    const std::string& document_id,
    const auth::UserIdentity& user
) {
    auto access_res = check_doc_access(document_id, user);
    if (!access_res.has_value()) return std::unexpected(access_res.error());
    if (access_res.value() < db::AccessLevel::Read) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    std::vector<TaskRecord> list;
    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT t.id::text, t.document_id::text, t.comment_id::text, t.description, "
            "       t.is_completed, t.due_date::text, t.created_at::text, t.completed_at::text, "
            "       u.id::text, u.username, u.display_name, u.avatar_color, "
            "       COALESCE(t.source, 'review'), t.line_number "
            "FROM tasks t "
            "LEFT JOIN users u ON t.assignee_id = u.id "
            "WHERE t.document_id = $1::uuid "
            "ORDER BY t.created_at ASC;",
            document_id
        );

        for (const auto& row : rows) {
            std::optional<AuthorInfo> assignee;
            if (!row[8].is_null()) {
                assignee = AuthorInfo{
                    .id = row[8].as<std::string>(),
                    .username = row[9].as<std::string>(),
                    .display_name = row[10].as<std::string>(),
                    .avatar_color = row[11].as<std::string>()
                };
            }

            list.push_back(TaskRecord{
                .id = row[0].as<std::string>(),
                .document_id = row[1].as<std::string>(),
                .document_title = "",
                .document_path = "",
                .comment_id = row[2].is_null() ? std::nullopt : std::optional<std::string>(row[2].as<std::string>()),
                .description = row[3].as<std::string>(),
                .assignee = assignee,
                .is_completed = row[4].as<bool>(),
                .due_date = row[5].is_null() ? std::nullopt : std::optional<std::string>(row[5].as<std::string>()),
                .created_at = row[6].as<std::string>(),
                .completed_at = row[7].is_null() ? std::nullopt : std::optional<std::string>(row[7].as<std::string>()),
                .source = row[12].as<std::string>(),
                .line_number = row[13].is_null() ? std::nullopt : std::optional<int>(row[13].as<int>())
            });
        }
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::list_tasks failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }

    return list;
}

Result<std::vector<TaskRecord>> ReviewService::list_all_tasks(
    const auth::UserIdentity& user,
    std::optional<bool> completed_filter,
    bool assigned_to_me_only
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    std::vector<TaskRecord> list;
    try {
        pqxx::work tx(conn_res->get());
        std::string q =
            "SELECT t.id::text, t.document_id::text, t.comment_id::text, t.description, "
            "       t.is_completed, t.due_date::text, t.created_at::text, t.completed_at::text, "
            "       u.id::text, u.username, u.display_name, u.avatar_color, "
            "       COALESCE(d.title, 'Untitled Document'), COALESCE(d.fs_path, ''), "
            "       COALESCE(t.source, 'review'), t.line_number "
            "FROM tasks t "
            "JOIN documents d ON t.document_id = d.id "
            "LEFT JOIN users u ON t.assignee_id = u.id "
            "WHERE 1=1 ";

        if (completed_filter.has_value()) {
            q += completed_filter.value() ? "AND t.is_completed = TRUE " : "AND t.is_completed = FALSE ";
        }
        if (assigned_to_me_only) {
            q += "AND t.assignee_id = " + tx.quote(user.user_id) + " ";
        }

        q += "ORDER BY t.created_at DESC;";

        auto rows = tx.exec(q);
        for (const auto& row : rows) {
            std::optional<AuthorInfo> assignee;
            if (!row[8].is_null()) {
                assignee = AuthorInfo{
                    .id = row[8].as<std::string>(),
                    .username = row[9].as<std::string>(),
                    .display_name = row[10].as<std::string>(),
                    .avatar_color = row[11].as<std::string>()
                };
            }

            list.push_back(TaskRecord{
                .id = row[0].as<std::string>(),
                .document_id = row[1].as<std::string>(),
                .document_title = row[12].as<std::string>(),
                .document_path = row[13].as<std::string>(),
                .comment_id = row[2].is_null() ? std::nullopt : std::optional<std::string>(row[2].as<std::string>()),
                .description = row[3].as<std::string>(),
                .assignee = assignee,
                .is_completed = row[4].as<bool>(),
                .due_date = row[5].is_null() ? std::nullopt : std::optional<std::string>(row[5].as<std::string>()),
                .created_at = row[6].as<std::string>(),
                .completed_at = row[7].is_null() ? std::nullopt : std::optional<std::string>(row[7].as<std::string>()),
                .source = row[14].as<std::string>(),
                .line_number = row[15].is_null() ? std::nullopt : std::optional<int>(row[15].as<int>())
            });
        }
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::list_all_tasks failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }

    return list;
}

Result<TaskRecord> ReviewService::get_task(
    const std::string& task_id,
    const auth::UserIdentity& user
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    TaskRecord rec;
    std::string doc_id;
    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT t.id::text, t.document_id::text, t.comment_id::text, t.description, "
            "       t.is_completed, t.due_date::text, t.created_at::text, t.completed_at::text, "
            "       u.id::text, u.username, u.display_name, u.avatar_color, "
            "       COALESCE(d.title, 'Untitled Document'), COALESCE(d.fs_path, ''), "
            "       COALESCE(t.source, 'review'), t.line_number "
            "FROM tasks t "
            "JOIN documents d ON t.document_id = d.id "
            "LEFT JOIN users u ON t.assignee_id = u.id "
            "WHERE t.id = $1::uuid;",
            task_id
        );
        if (rows.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }
        const auto& row = rows[0];
        doc_id = row[1].as<std::string>();

        std::optional<AuthorInfo> assignee;
        if (!row[8].is_null()) {
            assignee = AuthorInfo{
                .id = row[8].as<std::string>(),
                .username = row[9].as<std::string>(),
                .display_name = row[10].as<std::string>(),
                .avatar_color = row[11].as<std::string>()
            };
        }

        rec = TaskRecord{
            .id = row[0].as<std::string>(),
            .document_id = doc_id,
            .document_title = row[12].as<std::string>(),
            .document_path = row[13].as<std::string>(),
            .comment_id = row[2].is_null() ? std::nullopt : std::optional<std::string>(row[2].as<std::string>()),
            .description = row[3].as<std::string>(),
            .assignee = assignee,
            .is_completed = row[4].as<bool>(),
            .due_date = row[5].is_null() ? std::nullopt : std::optional<std::string>(row[5].as<std::string>()),
            .created_at = row[6].as<std::string>(),
            .completed_at = row[7].is_null() ? std::nullopt : std::optional<std::string>(row[7].as<std::string>()),
            .source = row[14].as<std::string>(),
            .line_number = row[15].is_null() ? std::nullopt : std::optional<int>(row[15].as<int>())
        };
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::get_task failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto access_res = check_doc_access(doc_id, user);
    if (!access_res.has_value()) return std::unexpected(access_res.error());
    if (access_res.value() < db::AccessLevel::Read) return std::unexpected(ErrorCode::PermissionDenied);

    return rec;
}

Result<TaskRecord> ReviewService::create_task(
    const std::string& document_id,
    const auth::UserIdentity& user,
    const CreateTaskRequest& req
) {
    if (req.description.empty()) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    auto access_res = check_doc_access(document_id, user);
    if (!access_res.has_value()) return std::unexpected(access_res.error());
    if (access_res.value() < db::AccessLevel::Comment) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    std::string task_id;
    try {
        pqxx::work tx(conn_res->get());
        pqxx::result rows;
        if (req.comment_id.has_value() && req.assignee_id.has_value() && req.due_date.has_value()) {
            rows = tx.exec_params(
                "INSERT INTO tasks (document_id, comment_id, description, assignee_id, due_date) "
                "VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::timestamptz) "
                "RETURNING id::text;",
                document_id, *req.comment_id, req.description, *req.assignee_id, *req.due_date
            );
        } else if (req.comment_id.has_value() && req.assignee_id.has_value()) {
            rows = tx.exec_params(
                "INSERT INTO tasks (document_id, comment_id, description, assignee_id) "
                "VALUES ($1::uuid, $2::uuid, $3, $4::uuid) "
                "RETURNING id::text;",
                document_id, *req.comment_id, req.description, *req.assignee_id
            );
        } else if (req.comment_id.has_value() && req.due_date.has_value()) {
            rows = tx.exec_params(
                "INSERT INTO tasks (document_id, comment_id, description, due_date) "
                "VALUES ($1::uuid, $2::uuid, $3, $4::timestamptz) "
                "RETURNING id::text;",
                document_id, *req.comment_id, req.description, *req.due_date
            );
        } else if (req.comment_id.has_value()) {
            rows = tx.exec_params(
                "INSERT INTO tasks (document_id, comment_id, description) "
                "VALUES ($1::uuid, $2::uuid, $3) "
                "RETURNING id::text;",
                document_id, *req.comment_id, req.description
            );
        } else if (req.assignee_id.has_value() && req.due_date.has_value()) {
            rows = tx.exec_params(
                "INSERT INTO tasks (document_id, description, assignee_id, due_date) "
                "VALUES ($1::uuid, $2, $3::uuid, $4::timestamptz) "
                "RETURNING id::text;",
                document_id, req.description, *req.assignee_id, *req.due_date
            );
        } else if (req.assignee_id.has_value()) {
            rows = tx.exec_params(
                "INSERT INTO tasks (document_id, description, assignee_id) "
                "VALUES ($1::uuid, $2, $3::uuid) "
                "RETURNING id::text;",
                document_id, req.description, *req.assignee_id
            );
        } else if (req.due_date.has_value()) {
            rows = tx.exec_params(
                "INSERT INTO tasks (document_id, description, due_date) "
                "VALUES ($1::uuid, $2, $3::timestamptz) "
                "RETURNING id::text;",
                document_id, req.description, *req.due_date
            );
        } else {
            rows = tx.exec_params(
                "INSERT INTO tasks (document_id, description) "
                "VALUES ($1::uuid, $2) "
                "RETURNING id::text;",
                document_id, req.description
            );
        }
        tx.commit();

        if (rows.empty()) return std::unexpected(ErrorCode::DatabaseError);
        task_id = rows[0][0].as<std::string>();
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::create_task failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }

    return get_task(task_id, user);
}

Result<TaskRecord> ReviewService::update_task(
    const std::string& task_id,
    const auth::UserIdentity& user,
    const UpdateTaskRequest& req,
    std::shared_ptr<collab::RoomManager> room_manager,
    std::function<void(const std::string& doc_id, std::span<const uint8_t> delta)> broadcast_sync_cb
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    std::string doc_id;
    std::string task_source = "review";
    int task_line = 0;
    std::string task_raw_line;
    std::string task_desc;
    bool current_is_completed = false;

    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT document_id::text, COALESCE(source, 'review'), COALESCE(line_number, 0), "
            "       COALESCE(raw_line, ''), description, is_completed "
            "FROM tasks WHERE id = $1::uuid;",
            task_id
        );
        if (rows.empty()) return std::unexpected(ErrorCode::NotFound);
        doc_id = rows[0][0].as<std::string>();
        task_source = rows[0][1].as<std::string>();
        task_line = rows[0][2].as<int>();
        task_raw_line = rows[0][3].as<std::string>();
        task_desc = rows[0][4].as<std::string>();
        current_is_completed = rows[0][5].as<bool>();
    } catch (...) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto access_res = check_doc_access(doc_id, user);
    if (!access_res.has_value()) return std::unexpected(access_res.error());
    if (task_source == "markdown") {
        if (access_res.value() < db::AccessLevel::Edit) {
            return std::unexpected(ErrorCode::PermissionDenied);
        }
    } else {
        if (access_res.value() < db::AccessLevel::Comment) {
            return std::unexpected(ErrorCode::PermissionDenied);
        }
    }

    // If this is a markdown task and completion status is changing: update the markdown document!
    if (task_source == "markdown" && req.is_completed.has_value() && req.is_completed.value() != current_is_completed) {
        bool target_completed = req.is_completed.value();

        std::shared_ptr<collab::DocumentRoom> room;
        if (room_manager) {
            room = room_manager->get_room(doc_id);
            if (!room && doc_service_) {
                auto d = doc_service_->get_document_by_id(doc_id, user);
                if (d.has_value()) {
                    std::vector<uint8_t> crdt_state;
                    if (doc_service_->storage()) {
                        auto crdt_res = doc_service_->storage()->load_crdt_state(doc_id);
                        if (crdt_res.has_value()) {
                            crdt_state = std::move(*crdt_res);
                        }
                    }
                    room = room_manager->get_or_create_room(doc_id, d->content, d->path, crdt_state);
                }
            }
        }

        std::string content;
        std::string fs_path;
        if (room) {
            content = room->get_content();
            fs_path = room->fs_path();
        } else if (doc_service_) {
            auto d = doc_service_->get_document_by_id(doc_id, user);
            if (d.has_value()) {
                content = d->content;
                fs_path = d->path;
            }
        }

        // Split content into lines and locate the task checkbox
        std::vector<std::pair<size_t, std::string_view>> lines;
        size_t cur = 0;
        while (cur < content.size()) {
            size_t nl = content.find('\n', cur);
            size_t len = (nl == std::string::npos) ? (content.size() - cur) : (nl - cur);
            std::string_view l = std::string_view(content).substr(cur, len);
            if (!l.empty() && l.back() == '\r') l.remove_suffix(1);
            lines.emplace_back(cur, l);
            if (nl == std::string::npos) break;
            cur = nl + 1;
        }

        size_t target_box_pos = std::string::npos;
        std::string old_box;
        bool found_line = false;
        size_t matched_line_idx = 0;

        auto check_line_for_task = [&](std::string_view l, size_t line_offset) -> bool {
            size_t sp = 0;
            while (sp < l.size() && (l[sp] == ' ' || l[sp] == '\t')) sp++;
            size_t b_len = 0;
            if (sp + 1 < l.size() && (l[sp] == '-' || l[sp] == '*' || l[sp] == '+') && l[sp + 1] == ' ') {
                b_len = 2;
            } else {
                size_t d = sp;
                while (d < l.size() && std::isdigit(static_cast<unsigned char>(l[d]))) d++;
                if (d > sp && d + 1 < l.size() && l[d] == '.' && l[d + 1] == ' ') {
                    b_len = (d + 2) - sp;
                }
            }
            if (b_len > 0 && sp + b_len + 3 <= l.size()) {
                size_t b_start = sp + b_len;
                if (l[b_start] == '[' && (l[b_start + 1] == ' ' || l[b_start + 1] == 'x' || l[b_start + 1] == 'X') && l[b_start + 2] == ']') {
                    target_box_pos = line_offset + b_start;
                    old_box = std::string(l.substr(b_start, 3));
                    return true;
                }
            }
            return false;
        };

        if (task_line >= 1 && static_cast<size_t>(task_line) <= lines.size()) {
            size_t idx = static_cast<size_t>(task_line - 1);
            if (check_line_for_task(lines[idx].second, lines[idx].first)) {
                if (lines[idx].second.find(task_desc) != std::string_view::npos ||
                    (!task_raw_line.empty() && lines[idx].second.find(task_raw_line.substr(std::min<size_t>(5, task_raw_line.size()))) != std::string_view::npos)) {
                    found_line = true;
                    matched_line_idx = idx;
                }
            }
        }

        if (!found_line) {
            for (size_t idx = 0; idx < lines.size(); ++idx) {
                if (lines[idx].second.find(task_desc) != std::string_view::npos) {
                    if (check_line_for_task(lines[idx].second, lines[idx].first)) {
                        found_line = true;
                        matched_line_idx = idx;
                        break;
                    }
                }
            }
        }

        if (found_line && target_box_pos != std::string::npos) {
            std::string new_box = target_completed ? "[x]" : "[ ]";
            if (room) {
                room->delete_text(static_cast<uint32_t>(target_box_pos), 3);
                room->insert_text(static_cast<uint32_t>(target_box_pos), new_box);
                if (broadcast_sync_cb) {
                    std::vector<uint8_t> empty_sv = {0};
                    auto delta = room->compute_sync_step2(empty_sv);
                    if (!delta.empty()) {
                        broadcast_sync_cb(doc_id, delta);
                    }
                }
            } else if (doc_service_ && doc_service_->storage()) {
                content.replace(target_box_pos, 3, new_box);
                bool is_bundle = doc_service_->storage()->is_bundle(fs_path).value_or(false);
                std::string content_file = is_bundle ? (fs_path + "/index.md") : fs_path;
                doc_service_->storage()->write_file(content_file, content, true);
            }

            // Update raw_line in tasks table
            std::string updated_raw_line = std::string(lines[matched_line_idx].second);
            size_t rbox = updated_raw_line.find(old_box);
            if (rbox != std::string::npos) {
                updated_raw_line.replace(rbox, 3, new_box);
            }
            try {
                pqxx::work tx(conn_res->get());
                tx.exec_params(
                    "UPDATE tasks SET raw_line = $1, line_number = $2 WHERE id = $3::uuid;",
                    updated_raw_line,
                    static_cast<int>(matched_line_idx + 1),
                    task_id
                );
                tx.commit();
            } catch (...) {}
        }
    }

    try {
        pqxx::work tx(conn_res->get());
        std::vector<std::string> set_clauses;

        if (req.is_completed.has_value()) {
            if (req.is_completed.value()) {
                set_clauses.push_back("is_completed = TRUE, completed_at = NOW()");
            } else {
                set_clauses.push_back("is_completed = FALSE, completed_at = NULL");
            }
        }

        if (req.description.has_value()) {
            if (req.description.value().empty()) {
                return std::unexpected(ErrorCode::InvalidArgument);
            }
            set_clauses.push_back("description = " + tx.quote(req.description.value()));
        }

        if (req.assignee_id.has_value()) {
            if (req.assignee_id.value().empty()) {
                set_clauses.push_back("assignee_id = NULL");
            } else {
                set_clauses.push_back("assignee_id = " + tx.quote(req.assignee_id.value()) + "::uuid");
            }
        }

        if (req.due_date.has_value()) {
            if (req.due_date.value().empty()) {
                set_clauses.push_back("due_date = NULL");
            } else {
                set_clauses.push_back("due_date = " + tx.quote(req.due_date.value()) + "::timestamptz");
            }
        }

        if (!set_clauses.empty()) {
            std::string q = "UPDATE tasks SET ";
            for (size_t i = 0; i < set_clauses.size(); ++i) {
                if (i > 0) q += ", ";
                q += set_clauses[i];
            }
            q += " WHERE id = " + tx.quote(task_id) + "::uuid;";
            tx.exec(q);
            tx.commit();
        }

        return get_task(task_id, user);
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::update_task failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<TaskRecord> ReviewService::update_task(
    const std::string& task_id,
    const auth::UserIdentity& user,
    bool is_completed,
    std::shared_ptr<collab::RoomManager> room_manager,
    std::function<void(const std::string& doc_id, std::span<const uint8_t> delta)> broadcast_sync_cb
) {
    UpdateTaskRequest req;
    req.is_completed = is_completed;
    return update_task(task_id, user, req, std::move(room_manager), std::move(broadcast_sync_cb));
}

Result<void> ReviewService::delete_task(
    const std::string& task_id,
    const auth::UserIdentity& user
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    std::string doc_id;
    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params("SELECT document_id::text FROM tasks WHERE id = $1::uuid;", task_id);
        if (rows.empty()) return std::unexpected(ErrorCode::NotFound);
        doc_id = rows[0][0].as<std::string>();
    } catch (...) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto access_res = check_doc_access(doc_id, user);
    if (!access_res.has_value()) return std::unexpected(access_res.error());
    if (access_res.value() < db::AccessLevel::Edit) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    try {
        pqxx::work tx(conn_res->get());
        tx.exec_params("DELETE FROM tasks WHERE id = $1::uuid;", task_id);
        tx.commit();
        return {};
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::delete_task failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

} // namespace cme::review
