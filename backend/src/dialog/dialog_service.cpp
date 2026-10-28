#include "cme/dialog/dialog_service.hpp"
#include "cme/auth/crypto_utils.hpp"
#include <iostream>

namespace cme::dialog {

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

DialogService::DialogService(std::shared_ptr<db::ConnectionPool> db_pool)
    : db_pool_(std::move(db_pool)) {}

Result<DialogRecord> DialogService::create_dialog(const std::string& user_id, const std::string& title) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    if (!is_valid_uuid(user_id)) return std::unexpected(ErrorCode::InvalidArgument);

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        std::string effective_title = title.empty() ? "New Dialog" : title;
        auto rows = tx.exec_params(
            "INSERT INTO dialogs (user_id, title, created_at, updated_at) "
            "VALUES ($1::uuid, $2, NOW(), NOW()) "
            "RETURNING id, user_id, title, created_at::text, updated_at::text;",
            user_id, effective_title
        );

        if (rows.empty()) {
            return std::unexpected(ErrorCode::DatabaseError);
        }

        DialogRecord rec{
            .id = rows[0][0].as<std::string>(),
            .user_id = rows[0][1].as<std::string>(),
            .title = rows[0][2].as<std::string>(),
            .created_at = rows[0][3].as<std::string>(),
            .updated_at = rows[0][4].as<std::string>(),
            .message_count = 0
        };

        tx.commit();
        return rec;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] create_dialog failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<std::vector<DialogRecord>> DialogService::list_dialogs(const std::string& user_id) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    if (!is_valid_uuid(user_id)) return std::unexpected(ErrorCode::InvalidArgument);

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT d.id, d.user_id, d.title, d.created_at::text, d.updated_at::text, "
            "       COUNT(m.id) AS message_count "
            "FROM dialogs d "
            "LEFT JOIN dialog_messages m ON m.dialog_id = d.id "
            "WHERE d.user_id = $1::uuid "
            "GROUP BY d.id "
            "ORDER BY d.updated_at DESC;",
            user_id
        );

        std::vector<DialogRecord> list;
        list.reserve(rows.size());
        for (const auto& row : rows) {
            list.push_back({
                .id = row[0].as<std::string>(),
                .user_id = row[1].as<std::string>(),
                .title = row[2].as<std::string>(),
                .created_at = row[3].as<std::string>(),
                .updated_at = row[4].as<std::string>(),
                .message_count = row[5].as<size_t>()
            });
        }

        return list;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] list_dialogs failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<DialogRecord> DialogService::get_dialog(const std::string& user_id, const std::string& dialog_id) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    if (!is_valid_uuid(user_id) || !is_valid_uuid(dialog_id)) return std::unexpected(ErrorCode::InvalidArgument);

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT d.id, d.user_id, d.title, d.created_at::text, d.updated_at::text, "
            "       COUNT(m.id) AS message_count "
            "FROM dialogs d "
            "LEFT JOIN dialog_messages m ON m.dialog_id = d.id "
            "WHERE d.id = $1::uuid AND d.user_id = $2::uuid "
            "GROUP BY d.id;",
            dialog_id, user_id
        );

        if (rows.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }

        return DialogRecord{
            .id = rows[0][0].as<std::string>(),
            .user_id = rows[0][1].as<std::string>(),
            .title = rows[0][2].as<std::string>(),
            .created_at = rows[0][3].as<std::string>(),
            .updated_at = rows[0][4].as<std::string>(),
            .message_count = rows[0][5].as<size_t>()
        };
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] get_dialog failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<DialogRecord> DialogService::update_dialog(const std::string& user_id, const std::string& dialog_id, const std::string& title) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    if (!is_valid_uuid(user_id) || !is_valid_uuid(dialog_id)) return std::unexpected(ErrorCode::InvalidArgument);
    if (title.empty()) return std::unexpected(ErrorCode::InvalidArgument);

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "UPDATE dialogs "
            "SET title = $1, updated_at = NOW() "
            "WHERE id = $2::uuid AND user_id = $3::uuid "
            "RETURNING id, user_id, title, created_at::text, updated_at::text;",
            title, dialog_id, user_id
        );

        if (rows.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }

        auto count_rows = tx.exec_params(
            "SELECT COUNT(id) FROM dialog_messages WHERE dialog_id = $1::uuid;",
            dialog_id
        );
        size_t count = count_rows.empty() ? 0 : count_rows[0][0].as<size_t>();

        DialogRecord rec{
            .id = rows[0][0].as<std::string>(),
            .user_id = rows[0][1].as<std::string>(),
            .title = rows[0][2].as<std::string>(),
            .created_at = rows[0][3].as<std::string>(),
            .updated_at = rows[0][4].as<std::string>(),
            .message_count = count
        };

        tx.commit();
        return rec;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] update_dialog failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<void> DialogService::delete_dialog(const std::string& user_id, const std::string& dialog_id) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    if (!is_valid_uuid(user_id) || !is_valid_uuid(dialog_id)) return std::unexpected(ErrorCode::InvalidArgument);

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        auto res = tx.exec_params(
            "DELETE FROM dialogs WHERE id = $1::uuid AND user_id = $2::uuid;",
            dialog_id, user_id
        );

        if (res.affected_rows() == 0) {
            return std::unexpected(ErrorCode::NotFound);
        }

        tx.commit();
        return {};
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] delete_dialog failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<std::optional<std::string>> DialogService::get_document_dialog(const std::string& user_id, const std::string& document_id) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    if (!is_valid_uuid(user_id)) return std::unexpected(ErrorCode::InvalidArgument);

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        std::string real_doc_id = document_id;
        if (!is_valid_uuid(document_id)) {
            auto r = tx.exec_params("SELECT id FROM documents WHERE fs_path = $1;", document_id);
            if (r.empty()) {
                return std::unexpected(ErrorCode::NotFound);
            }
            real_doc_id = r[0][0].as<std::string>();
        }

        auto rows = tx.exec_params(
            "SELECT last_dialog_id FROM user_document_dialogs "
            "WHERE user_id = $1::uuid AND document_id = $2::uuid;",
            user_id, real_doc_id
        );

        if (rows.empty() || rows[0][0].is_null()) {
            return std::nullopt;
        }

        return rows[0][0].as<std::string>();
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] get_document_dialog failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<void> DialogService::set_document_dialog(const std::string& user_id, const std::string& document_id, const std::string& dialog_id) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    if (!is_valid_uuid(user_id)) return std::unexpected(ErrorCode::InvalidArgument);
    if (!dialog_id.empty() && !is_valid_uuid(dialog_id)) return std::unexpected(ErrorCode::InvalidArgument);

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        std::string real_doc_id = document_id;
        if (!is_valid_uuid(document_id)) {
            auto r = tx.exec_params("SELECT id FROM documents WHERE fs_path = $1;", document_id);
            if (r.empty()) {
                return std::unexpected(ErrorCode::NotFound);
            }
            real_doc_id = r[0][0].as<std::string>();
        }

        if (!dialog_id.empty()) {
            // Validate dialog exists and belongs to user
            auto check = tx.exec_params(
                "SELECT 1 FROM dialogs WHERE id = $1::uuid AND user_id = $2::uuid;",
                dialog_id, user_id
            );
            if (check.empty()) {
                return std::unexpected(ErrorCode::NotFound);
            }

            tx.exec_params(
                "INSERT INTO user_document_dialogs (user_id, document_id, last_dialog_id, updated_at) "
                "VALUES ($1::uuid, $2::uuid, $3::uuid, NOW()) "
                "ON CONFLICT (user_id, document_id) "
                "DO UPDATE SET last_dialog_id = EXCLUDED.last_dialog_id, updated_at = NOW();",
                user_id, real_doc_id, dialog_id
            );
        } else {
            tx.exec_params(
                "INSERT INTO user_document_dialogs (user_id, document_id, last_dialog_id, updated_at) "
                "VALUES ($1::uuid, $2::uuid, NULL, NOW()) "
                "ON CONFLICT (user_id, document_id) "
                "DO UPDATE SET last_dialog_id = NULL, updated_at = NOW();",
                user_id, real_doc_id
            );
        }

        tx.commit();
        return {};
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] set_document_dialog failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<std::vector<DialogMessageRecord>> DialogService::list_messages(const std::string& user_id, const std::string& dialog_id, size_t limit) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    if (!is_valid_uuid(user_id) || !is_valid_uuid(dialog_id)) return std::unexpected(ErrorCode::InvalidArgument);

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());

        // Validate dialog belongs to user
        auto check = tx.exec_params(
            "SELECT 1 FROM dialogs WHERE id = $1::uuid AND user_id = $2::uuid;",
            dialog_id, user_id
        );
        if (check.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }

        auto rows = tx.exec_params(
            "SELECT id, dialog_id, role, content, context_snapshot::text, created_at::text "
            "FROM dialog_messages "
            "WHERE dialog_id = $1::uuid "
            "ORDER BY created_at ASC "
            "LIMIT $2;",
            dialog_id, limit
        );

        std::vector<DialogMessageRecord> messages;
        messages.reserve(rows.size());
        for (const auto& row : rows) {
            messages.push_back({
                .id = row[0].as<std::string>(),
                .dialog_id = row[1].as<std::string>(),
                .role = row[2].as<std::string>(),
                .content = row[3].as<std::string>(),
                .context_snapshot = parse_json_safe(row[4].as<std::string>()),
                .created_at = row[5].as<std::string>()
            });
        }

        return messages;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] list_messages failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<DialogMessageRecord> DialogService::add_message(
    const std::string& user_id,
    const std::string& dialog_id,
    const std::string& role,
    const std::string& content,
    const nlohmann::json& context_snapshot
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    if (!is_valid_uuid(user_id) || !is_valid_uuid(dialog_id)) return std::unexpected(ErrorCode::InvalidArgument);
    if (role.empty() || content.empty()) return std::unexpected(ErrorCode::InvalidArgument);

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());

        // Verify dialog belongs to user
        auto check = tx.exec_params(
            "SELECT 1 FROM dialogs WHERE id = $1::uuid AND user_id = $2::uuid;",
            dialog_id, user_id
        );
        if (check.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }

        std::string json_str = context_snapshot.is_null() ? "{}" : context_snapshot.dump();
        auto rows = tx.exec_params(
            "INSERT INTO dialog_messages (dialog_id, role, content, context_snapshot, created_at) "
            "VALUES ($1::uuid, $2, $3, $4::jsonb, NOW()) "
            "RETURNING id, dialog_id, role, content, context_snapshot::text, created_at::text;",
            dialog_id, role, content, json_str
        );

        if (rows.empty()) {
            return std::unexpected(ErrorCode::DatabaseError);
        }

        // Touch updated_at on dialog
        tx.exec_params(
            "UPDATE dialogs SET updated_at = NOW() WHERE id = $1::uuid;",
            dialog_id
        );

        DialogMessageRecord msg{
            .id = rows[0][0].as<std::string>(),
            .dialog_id = rows[0][1].as<std::string>(),
            .role = rows[0][2].as<std::string>(),
            .content = rows[0][3].as<std::string>(),
            .context_snapshot = parse_json_safe(rows[0][4].as<std::string>()),
            .created_at = rows[0][5].as<std::string>()
        };

        tx.commit();
        return msg;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] add_message failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<std::vector<DialogMessageRecord>> DialogService::truncate_dialog(
    const std::string& user_id,
    const std::string& dialog_id,
    const std::string& target_message_id,
    bool inclusive
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    if (!is_valid_uuid(user_id) || !is_valid_uuid(dialog_id) || !is_valid_uuid(target_message_id)) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());

        // Verify dialog belongs to user
        auto check = tx.exec_params(
            "SELECT 1 FROM dialogs WHERE id = $1::uuid AND user_id = $2::uuid;",
            dialog_id, user_id
        );
        if (check.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }

        // Verify target_message_id exists in this dialog
        auto target_rows = tx.exec_params(
            "SELECT created_at::text FROM dialog_messages WHERE id = $1::uuid AND dialog_id = $2::uuid;",
            target_message_id, dialog_id
        );
        if (target_rows.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }
        std::string target_created_at = target_rows[0][0].as<std::string>();

        if (inclusive) {
            tx.exec_params(
                "DELETE FROM dialog_messages WHERE dialog_id = $1::uuid AND (created_at > $2::timestamptz OR id = $3::uuid);",
                dialog_id, target_created_at, target_message_id
            );
        } else {
            tx.exec_params(
                "DELETE FROM dialog_messages WHERE dialog_id = $1::uuid AND created_at > $2::timestamptz AND id != $3::uuid;",
                dialog_id, target_created_at, target_message_id
            );
        }

        // Update dialog updated_at
        tx.exec_params(
            "UPDATE dialogs SET updated_at = NOW() WHERE id = $1::uuid;",
            dialog_id
        );

        // Fetch remaining messages
        auto rows = tx.exec_params(
            "SELECT id, dialog_id, role, content, context_snapshot::text, created_at::text "
            "FROM dialog_messages "
            "WHERE dialog_id = $1::uuid "
            "ORDER BY created_at ASC;",
            dialog_id
        );

        std::vector<DialogMessageRecord> remaining;
        remaining.reserve(rows.size());
        for (const auto& row : rows) {
            remaining.push_back({
                .id = row[0].as<std::string>(),
                .dialog_id = row[1].as<std::string>(),
                .role = row[2].as<std::string>(),
                .content = row[3].as<std::string>(),
                .context_snapshot = parse_json_safe(row[4].as<std::string>()),
                .created_at = row[5].as<std::string>()
            });
        }

        tx.commit();
        return remaining;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] truncate_dialog failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<DialogRecord> DialogService::fork_dialog(
    const std::string& user_id,
    const std::string& source_dialog_id,
    const std::optional<std::string>& up_to_message_id,
    const std::string& custom_title
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    if (!is_valid_uuid(user_id) || !is_valid_uuid(source_dialog_id)) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }
    if (up_to_message_id.has_value() && !up_to_message_id->empty() && !is_valid_uuid(*up_to_message_id)) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());

        // Verify source dialog belongs to user and get title
        auto src_rows = tx.exec_params(
            "SELECT title FROM dialogs WHERE id = $1::uuid AND user_id = $2::uuid;",
            source_dialog_id, user_id
        );
        if (src_rows.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }
        std::string src_title = src_rows[0][0].as<std::string>();
        std::string effective_title = custom_title.empty() ? ("Fork of " + src_title) : custom_title;

        // Insert new dialog
        auto new_dlg_rows = tx.exec_params(
            "INSERT INTO dialogs (user_id, title, created_at, updated_at) "
            "VALUES ($1::uuid, $2, NOW(), NOW()) "
            "RETURNING id, user_id, title, created_at::text, updated_at::text;",
            user_id, effective_title
        );
        if (new_dlg_rows.empty()) {
            return std::unexpected(ErrorCode::DatabaseError);
        }
        std::string new_dialog_id = new_dlg_rows[0][0].as<std::string>();

        // Copy messages
        if (up_to_message_id.has_value() && !up_to_message_id->empty()) {
            auto msg_rows = tx.exec_params(
                "SELECT created_at::text FROM dialog_messages WHERE id = $1::uuid AND dialog_id = $2::uuid;",
                *up_to_message_id, source_dialog_id
            );
            if (msg_rows.empty()) {
                return std::unexpected(ErrorCode::NotFound);
            }
            std::string target_created_at = msg_rows[0][0].as<std::string>();

            tx.exec_params(
                "INSERT INTO dialog_messages (dialog_id, role, content, context_snapshot, created_at) "
                "SELECT $1::uuid, role, content, context_snapshot, created_at "
                "FROM dialog_messages "
                "WHERE dialog_id = $2::uuid AND (created_at < $3::timestamptz OR id = $4::uuid) "
                "ORDER BY created_at ASC;",
                new_dialog_id, source_dialog_id, target_created_at, *up_to_message_id
            );
        } else {
            tx.exec_params(
                "INSERT INTO dialog_messages (dialog_id, role, content, context_snapshot, created_at) "
                "SELECT $1::uuid, role, content, context_snapshot, created_at "
                "FROM dialog_messages "
                "WHERE dialog_id = $2::uuid "
                "ORDER BY created_at ASC;",
                new_dialog_id, source_dialog_id
            );
        }

        auto count_res = tx.exec_params(
            "SELECT count(*) FROM dialog_messages WHERE dialog_id = $1::uuid;",
            new_dialog_id
        );
        size_t msg_cnt = count_res.empty() ? 0 : count_res[0][0].as<size_t>();

        DialogRecord rec{
            .id = new_dlg_rows[0][0].as<std::string>(),
            .user_id = new_dlg_rows[0][1].as<std::string>(),
            .title = new_dlg_rows[0][2].as<std::string>(),
            .created_at = new_dlg_rows[0][3].as<std::string>(),
            .updated_at = new_dlg_rows[0][4].as<std::string>(),
            .message_count = msg_cnt
        };

        tx.commit();
        return rec;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] fork_dialog failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<CreatedAgentTokenResult> DialogService::create_agent_token(const std::string& user_id, const std::string& name) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    if (!is_valid_uuid(user_id)) return std::unexpected(ErrorCode::InvalidArgument);

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        std::string raw_token = auth::generate_random_token(32);
        std::string token_hash = auth::sha256_hex(raw_token);
        std::string effective_name = name.empty() ? "Default Local Agent" : name;

        auto rows = tx.exec_params(
            "INSERT INTO agent_tokens (user_id, token_hash, name, created_at) "
            "VALUES ($1::uuid, $2, $3, NOW()) "
            "RETURNING id, name, created_at::text;",
            user_id, token_hash, effective_name
        );

        if (rows.empty()) {
            return std::unexpected(ErrorCode::DatabaseError);
        }

        CreatedAgentTokenResult result{
            .id = rows[0][0].as<std::string>(),
            .name = rows[0][1].as<std::string>(),
            .token = raw_token,
            .created_at = rows[0][2].as<std::string>()
        };

        tx.commit();
        return result;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] create_agent_token failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<std::vector<AgentTokenRecord>> DialogService::list_agent_tokens(const std::string& user_id) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    if (!is_valid_uuid(user_id)) return std::unexpected(ErrorCode::InvalidArgument);

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT id, user_id, name, last_used_at::text, created_at::text "
            "FROM agent_tokens "
            "WHERE user_id = $1::uuid "
            "ORDER BY created_at DESC;",
            user_id
        );

        std::vector<AgentTokenRecord> list;
        list.reserve(rows.size());
        for (const auto& row : rows) {
            std::optional<std::string> last_used = row[3].is_null() ? std::nullopt : std::optional<std::string>(row[3].as<std::string>());
            list.push_back({
                .id = row[0].as<std::string>(),
                .user_id = row[1].as<std::string>(),
                .name = row[2].as<std::string>(),
                .last_used_at = last_used,
                .created_at = row[4].as<std::string>()
            });
        }

        return list;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] list_agent_tokens failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<void> DialogService::revoke_agent_token(const std::string& user_id, const std::string& token_id) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    if (!is_valid_uuid(user_id) || !is_valid_uuid(token_id)) return std::unexpected(ErrorCode::InvalidArgument);

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        auto res = tx.exec_params(
            "DELETE FROM agent_tokens WHERE id = $1::uuid AND user_id = $2::uuid;",
            token_id, user_id
        );

        if (res.affected_rows() == 0) {
            return std::unexpected(ErrorCode::NotFound);
        }

        tx.commit();
        return {};
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] revoke_agent_token failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<std::optional<std::string>> DialogService::validate_agent_token(const std::string& plaintext_token) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    if (plaintext_token.empty()) return std::nullopt;

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        std::string token_hash = auth::sha256_hex(plaintext_token);
        auto rows = tx.exec_params(
            "UPDATE agent_tokens "
            "SET last_used_at = NOW() "
            "WHERE token_hash = $1 "
            "RETURNING user_id;",
            token_hash
        );

        if (rows.empty()) {
            return std::nullopt;
        }

        std::string user_id = rows[0][0].as<std::string>();
        tx.commit();
        return user_id;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] validate_agent_token failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

} // namespace cme::dialog
