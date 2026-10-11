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
    doc_service_(std::move(doc_service)) {}

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
    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT fs_path FROM documents WHERE id = $1::uuid;",
            document_id
        );
        if (rows.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }
        fs_path = rows[0][0].as<std::string>();
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
        document_id,
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
            "WHERE c.document_id = $1::uuid "
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

Result<CommentRecord> ReviewService::update_comment_status(
    const std::string& comment_id,
    const auth::UserIdentity& user,
    const std::string& status
) {
    if (status != "OPEN" && status != "RESOLVED") {
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
                "WHERE s.document_id = $1::uuid "
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
                room = room_manager->get_or_create_room(doc_id, d->content, d->path);
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
            "       u.id::text, u.username, u.display_name, u.avatar_color "
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
                .comment_id = row[2].is_null() ? std::nullopt : std::optional<std::string>(row[2].as<std::string>()),
                .description = row[3].as<std::string>(),
                .assignee = assignee,
                .is_completed = row[4].as<bool>(),
                .due_date = row[5].is_null() ? std::nullopt : std::optional<std::string>(row[5].as<std::string>()),
                .created_at = row[6].as<std::string>(),
                .completed_at = row[7].is_null() ? std::nullopt : std::optional<std::string>(row[7].as<std::string>())
            });
        }
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::list_tasks failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }

    return list;
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

    try {
        pqxx::work tx(conn_res->get());
        pqxx::result rows;
        if (req.comment_id.has_value() && req.assignee_id.has_value() && req.due_date.has_value()) {
            rows = tx.exec_params(
                "INSERT INTO tasks (document_id, comment_id, description, assignee_id, due_date) "
                "VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::timestamptz) "
                "RETURNING id::text, created_at::text;",
                document_id, *req.comment_id, req.description, *req.assignee_id, *req.due_date
            );
        } else if (req.comment_id.has_value() && req.assignee_id.has_value()) {
            rows = tx.exec_params(
                "INSERT INTO tasks (document_id, comment_id, description, assignee_id) "
                "VALUES ($1::uuid, $2::uuid, $3, $4::uuid) "
                "RETURNING id::text, created_at::text;",
                document_id, *req.comment_id, req.description, *req.assignee_id
            );
        } else if (req.comment_id.has_value()) {
            rows = tx.exec_params(
                "INSERT INTO tasks (document_id, comment_id, description) "
                "VALUES ($1::uuid, $2::uuid, $3) "
                "RETURNING id::text, created_at::text;",
                document_id, *req.comment_id, req.description
            );
        } else if (req.assignee_id.has_value()) {
            rows = tx.exec_params(
                "INSERT INTO tasks (document_id, description, assignee_id) "
                "VALUES ($1::uuid, $2, $3::uuid) "
                "RETURNING id::text, created_at::text;",
                document_id, req.description, *req.assignee_id
            );
        } else {
            rows = tx.exec_params(
                "INSERT INTO tasks (document_id, description) "
                "VALUES ($1::uuid, $2) "
                "RETURNING id::text, created_at::text;",
                document_id, req.description
            );
        }
        tx.commit();

        if (rows.empty()) return std::unexpected(ErrorCode::DatabaseError);

        return TaskRecord{
            .id = rows[0][0].as<std::string>(),
            .document_id = document_id,
            .comment_id = req.comment_id,
            .description = req.description,
            .assignee = std::nullopt,
            .is_completed = false,
            .due_date = req.due_date,
            .created_at = rows[0][1].as<std::string>(),
            .completed_at = std::nullopt
        };
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::create_task failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<TaskRecord> ReviewService::update_task(
    const std::string& task_id,
    const auth::UserIdentity& user,
    bool is_completed
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
    if (access_res.value() < db::AccessLevel::Comment) {
        return std::unexpected(ErrorCode::PermissionDenied);
    }

    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "UPDATE tasks "
            "SET is_completed = $1, completed_at = CASE WHEN $1 THEN NOW() ELSE NULL END "
            "WHERE id = $2::uuid "
            "RETURNING id::text, document_id::text, comment_id::text, description, "
            "          is_completed, due_date::text, created_at::text, completed_at::text;",
            is_completed, task_id
        );
        tx.commit();

        if (rows.empty()) return std::unexpected(ErrorCode::NotFound);
        const auto& row = rows[0];

        return TaskRecord{
            .id = row[0].as<std::string>(),
            .document_id = row[1].as<std::string>(),
            .comment_id = row[2].is_null() ? std::nullopt : std::optional<std::string>(row[2].as<std::string>()),
            .description = row[3].as<std::string>(),
            .assignee = std::nullopt,
            .is_completed = row[4].as<bool>(),
            .due_date = row[5].is_null() ? std::nullopt : std::optional<std::string>(row[5].as<std::string>()),
            .created_at = row[6].as<std::string>(),
            .completed_at = row[7].is_null() ? std::nullopt : std::optional<std::string>(row[7].as<std::string>())
        };
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] ReviewService::update_task failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
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
