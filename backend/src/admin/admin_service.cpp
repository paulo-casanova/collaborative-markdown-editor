#include "cme/admin/admin_service.hpp"
#include "cme/auth/crypto_utils.hpp"
#include <iostream>
#include <pqxx/pqxx>

namespace cme::admin {

namespace {

std::optional<std::string> resolve_user_id(pqxx::transaction_base& tx, const std::string& input) {
    auto rows = tx.exec_params(
        "SELECT id::text FROM users WHERE id::text = $1 OR username = $1 LIMIT 1;",
        input
    );
    if (rows.empty()) return std::nullopt;
    return rows[0][0].as<std::string>();
}

std::optional<std::string> resolve_team_id(pqxx::transaction_base& tx, const std::string& input) {
    auto rows = tx.exec_params(
        "SELECT id::text FROM teams WHERE id::text = $1 OR name = $1 LIMIT 1;",
        input
    );
    if (rows.empty()) return std::nullopt;
    return rows[0][0].as<std::string>();
}

UserRecord map_user_row(const pqxx::row& row) {
    return UserRecord{
        .id = row[0].as<std::string>(),
        .username = row[1].as<std::string>(),
        .display_name = row[2].as<std::string>(),
        .avatar_color = row[3].as<std::string>(),
        .is_system_admin = row[4].as<bool>(),
        .created_at = row[5].as<std::string>(),
        .updated_at = row[6].as<std::string>()
    };
}

TeamRecord map_team_row(const pqxx::row& row) {
    return TeamRecord{
        .id = row[0].as<std::string>(),
        .name = row[1].as<std::string>(),
        .description = row[2].as<std::string>(),
        .created_at = row[3].as<std::string>()
    };
}

} // namespace

// ==============================================================================
// UserService Implementation
// ==============================================================================

UserService::UserService(std::shared_ptr<db::ConnectionPool> db_pool)
    : db_pool_(std::move(db_pool)) {}

Result<std::vector<UserRecord>> UserService::list_users() {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::read_transaction tx(conn_res->get());
        auto rows = tx.exec(
            "SELECT id::text, username, display_name, avatar_color, is_system_admin, "
            "created_at::text, updated_at::text FROM users ORDER BY username ASC;"
        );

        std::vector<UserRecord> users;
        users.reserve(static_cast<size_t>(rows.size()));
        for (const auto& row : rows) {
            users.push_back(map_user_row(row));
        }
        return users;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] UserService::list_users failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<UserRecord> UserService::get_user_by_id(const std::string& user_id_or_username) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::read_transaction tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT id::text, username, display_name, avatar_color, is_system_admin, "
            "created_at::text, updated_at::text FROM users WHERE id::text = $1 OR username = $1 LIMIT 1;",
            user_id_or_username
        );
        if (rows.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }
        return map_user_row(rows[0]);
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] UserService::get_user_by_id failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<UserRecord> UserService::create_user(const CreateUserRequest& req) {
    if (req.username.empty() || req.password.empty()) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    std::string password_hash = auth::hash_password_bcrypt(req.password);
    std::string display_name = req.display_name.empty() ? req.username : req.display_name;
    std::string avatar_color = req.avatar_color.empty() ? "#3b82f6" : req.avatar_color;

    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "INSERT INTO users (username, password_hash, display_name, avatar_color, is_system_admin) "
            "VALUES ($1, $2, $3, $4, $5) "
            "RETURNING id::text, username, display_name, avatar_color, is_system_admin, created_at::text, updated_at::text;",
            req.username, password_hash, display_name, avatar_color, req.is_system_admin
        );
        tx.commit();
        return map_user_row(rows[0]);
    } catch (const pqxx::unique_violation&) {
        return std::unexpected(ErrorCode::AlreadyExists);
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] UserService::create_user failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<UserRecord> UserService::update_user(const std::string& user_id_or_username, const UpdateUserRequest& req) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        auto resolved_id = resolve_user_id(tx, user_id_or_username);
        if (!resolved_id) {
            return std::unexpected(ErrorCode::NotFound);
        }

        std::optional<std::string> pass_hash;
        if (req.password.has_value() && !req.password->empty()) {
            pass_hash = auth::hash_password_bcrypt(*req.password);
        }

        std::string sql = "UPDATE users SET updated_at = NOW()";
        if (req.display_name.has_value()) {
            sql += ", display_name = " + tx.quote(*req.display_name);
        }
        if (req.avatar_color.has_value()) {
            sql += ", avatar_color = " + tx.quote(*req.avatar_color);
        }
        if (req.is_system_admin.has_value()) {
            sql += ", is_system_admin = " + std::string(*req.is_system_admin ? "TRUE" : "FALSE");
        }
        if (pass_hash.has_value()) {
            sql += ", password_hash = " + tx.quote(*pass_hash);
        }

        sql += " WHERE id = " + tx.quote(*resolved_id) + "::uuid "
               "RETURNING id::text, username, display_name, avatar_color, is_system_admin, created_at::text, updated_at::text;";

        auto rows = tx.exec(sql);
        if (rows.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }
        tx.commit();
        return map_user_row(rows[0]);
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] UserService::update_user failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<void> UserService::delete_user(const std::string& user_id_or_username) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        auto resolved_id = resolve_user_id(tx, user_id_or_username);
        if (!resolved_id) {
            return std::unexpected(ErrorCode::NotFound);
        }

        auto res = tx.exec_params("DELETE FROM users WHERE id = $1::uuid;", *resolved_id);
        if (res.affected_rows() == 0) {
            return std::unexpected(ErrorCode::NotFound);
        }
        tx.commit();
        return {};
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] UserService::delete_user failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<void> UserService::set_admin(const std::string& user_id_or_username, bool is_admin) {
    return update_user(user_id_or_username, UpdateUserRequest{.is_system_admin = is_admin}).transform([](const UserRecord&) {});
}

Result<void> UserService::reset_password(const std::string& user_id_or_username, const std::string& new_password) {
    if (new_password.empty()) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }
    return update_user(user_id_or_username, UpdateUserRequest{.password = new_password}).transform([](const UserRecord&) {});
}

// ==============================================================================
// TeamService Implementation
// ==============================================================================

TeamService::TeamService(std::shared_ptr<db::ConnectionPool> db_pool)
    : db_pool_(std::move(db_pool)) {}

Result<std::vector<TeamRecord>> TeamService::list_teams() {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::read_transaction tx(conn_res->get());
        auto rows = tx.exec(
            "SELECT id::text, name, COALESCE(description, ''), created_at::text "
            "FROM teams ORDER BY name ASC;"
        );

        std::vector<TeamRecord> teams;
        teams.reserve(static_cast<size_t>(rows.size()));
        for (const auto& row : rows) {
            teams.push_back(map_team_row(row));
        }
        return teams;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] TeamService::list_teams failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<TeamRecord> TeamService::get_team_by_id(const std::string& team_id_or_name) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::read_transaction tx(conn_res->get());
        auto rows = tx.exec_params(
            "SELECT id::text, name, COALESCE(description, ''), created_at::text "
            "FROM teams WHERE id::text = $1 OR name = $1 LIMIT 1;",
            team_id_or_name
        );
        if (rows.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }
        return map_team_row(rows[0]);
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] TeamService::get_team_by_id failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<TeamRecord> TeamService::create_team(const CreateTeamRequest& req) {
    if (req.name.empty()) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            "INSERT INTO teams (name, description) VALUES ($1, $2) "
            "RETURNING id::text, name, COALESCE(description, ''), created_at::text;",
            req.name, req.description
        );
        tx.commit();
        return map_team_row(rows[0]);
    } catch (const pqxx::unique_violation&) {
        return std::unexpected(ErrorCode::AlreadyExists);
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] TeamService::create_team failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<TeamRecord> TeamService::update_team(const std::string& team_id_or_name, const UpdateTeamRequest& req) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        auto resolved_id = resolve_team_id(tx, team_id_or_name);
        if (!resolved_id) {
            return std::unexpected(ErrorCode::NotFound);
        }

        std::string sql = "UPDATE teams SET ";
        bool has_fields = false;
        if (req.name.has_value() && !req.name->empty()) {
            sql += "name = " + tx.quote(*req.name);
            has_fields = true;
        }
        if (req.description.has_value()) {
            if (has_fields) sql += ", ";
            sql += "description = " + tx.quote(*req.description);
            has_fields = true;
        }

        if (!has_fields) {
            // Nothing to update, return existing
            return get_team_by_id(*resolved_id);
        }

        sql += " WHERE id = " + tx.quote(*resolved_id) + "::uuid "
               "RETURNING id::text, name, COALESCE(description, ''), created_at::text;";

        auto rows = tx.exec(sql);
        if (rows.empty()) {
            return std::unexpected(ErrorCode::NotFound);
        }
        tx.commit();
        return map_team_row(rows[0]);
    } catch (const pqxx::unique_violation&) {
        return std::unexpected(ErrorCode::AlreadyExists);
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] TeamService::update_team failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<void> TeamService::delete_team(const std::string& team_id_or_name) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        auto resolved_id = resolve_team_id(tx, team_id_or_name);
        if (!resolved_id) {
            return std::unexpected(ErrorCode::NotFound);
        }

        auto res = tx.exec_params("DELETE FROM teams WHERE id = $1::uuid;", *resolved_id);
        if (res.affected_rows() == 0) {
            return std::unexpected(ErrorCode::NotFound);
        }
        tx.commit();
        return {};
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] TeamService::delete_team failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<std::vector<TeamMemberRecord>> TeamService::list_members(const std::string& team_id_or_name) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::read_transaction tx(conn_res->get());
        auto resolved_id = resolve_team_id(tx, team_id_or_name);
        if (!resolved_id) {
            return std::unexpected(ErrorCode::NotFound);
        }

        auto rows = tx.exec_params(
            "SELECT tm.team_id::text, tm.user_id::text, u.username, u.display_name, u.avatar_color, tm.role "
            "FROM team_members tm "
            "JOIN users u ON tm.user_id = u.id "
            "WHERE tm.team_id = $1::uuid "
            "ORDER BY (CASE WHEN tm.role = 'lead' THEN 1 ELSE 2 END) ASC, u.username ASC;",
            *resolved_id
        );

        std::vector<TeamMemberRecord> members;
        members.reserve(static_cast<size_t>(rows.size()));
        for (const auto& row : rows) {
            members.push_back(TeamMemberRecord{
                .team_id = row[0].as<std::string>(),
                .user_id = row[1].as<std::string>(),
                .username = row[2].as<std::string>(),
                .display_name = row[3].as<std::string>(),
                .avatar_color = row[4].as<std::string>(),
                .role = row[5].as<std::string>()
            });
        }
        return members;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] TeamService::list_members failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<void> TeamService::add_member(
    const std::string& team_id_or_name,
    const std::string& user_id_or_username,
    const std::string& role
) {
    if (role != "member" && role != "lead") {
        return std::unexpected(ErrorCode::InvalidArgument);
    }
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        auto team_id = resolve_team_id(tx, team_id_or_name);
        if (!team_id) {
            return std::unexpected(ErrorCode::NotFound);
        }
        auto user_id = resolve_user_id(tx, user_id_or_username);
        if (!user_id) {
            return std::unexpected(ErrorCode::NotFound);
        }

        tx.exec_params(
            "INSERT INTO team_members (team_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3) "
            "ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role;",
            *team_id, *user_id, role
        );
        tx.commit();
        return {};
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] TeamService::add_member failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<void> TeamService::remove_member(
    const std::string& team_id_or_name,
    const std::string& user_id_or_username
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        auto team_id = resolve_team_id(tx, team_id_or_name);
        if (!team_id) {
            return std::unexpected(ErrorCode::NotFound);
        }
        auto user_id = resolve_user_id(tx, user_id_or_username);
        if (!user_id) {
            return std::unexpected(ErrorCode::NotFound);
        }

        auto res = tx.exec_params(
            "DELETE FROM team_members WHERE team_id = $1::uuid AND user_id = $2::uuid;",
            *team_id, *user_id
        );
        if (res.affected_rows() == 0) {
            return std::unexpected(ErrorCode::NotFound);
        }
        tx.commit();
        return {};
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] TeamService::remove_member failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<std::vector<TeamRecord>> TeamService::list_parents(const std::string& team_id_or_name) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::read_transaction tx(conn_res->get());
        auto team_id = resolve_team_id(tx, team_id_or_name);
        if (!team_id) {
            return std::unexpected(ErrorCode::NotFound);
        }

        auto rows = tx.exec_params(
            "SELECT t.id::text, t.name, COALESCE(t.description, ''), t.created_at::text "
            "FROM team_parents tp "
            "JOIN teams t ON tp.parent_team_id = t.id "
            "WHERE tp.child_team_id = $1::uuid "
            "ORDER BY t.name ASC;",
            *team_id
        );

        std::vector<TeamRecord> parents;
        parents.reserve(static_cast<size_t>(rows.size()));
        for (const auto& row : rows) {
            parents.push_back(map_team_row(row));
        }
        return parents;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] TeamService::list_parents failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<void> TeamService::add_parent(
    const std::string& child_team_id_or_name,
    const std::string& parent_team_id_or_name
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        auto child_id = resolve_team_id(tx, child_team_id_or_name);
        if (!child_id) {
            return std::unexpected(ErrorCode::NotFound);
        }
        auto parent_id = resolve_team_id(tx, parent_team_id_or_name);
        if (!parent_id) {
            return std::unexpected(ErrorCode::NotFound);
        }

        if (*child_id == *parent_id) {
            return std::unexpected(ErrorCode::InvalidArgument); // Self-parenting prohibited
        }

        // Cycle check: verify that parent_id is not already a descendant of child_id
        auto cycle_check = tx.exec_params(
            R"(
            WITH RECURSIVE descendants AS (
                SELECT child_team_id AS team_id FROM team_parents WHERE parent_team_id = $1::uuid
                UNION
                SELECT tp.child_team_id
                FROM team_parents tp
                JOIN descendants d ON tp.parent_team_id = d.team_id
            )
            SELECT 1 FROM descendants WHERE team_id = $2::uuid;
            )",
            *child_id, *parent_id
        );

        if (!cycle_check.empty()) {
            std::cerr << "[WARN] Cycle detected in team hierarchy: "
                      << *parent_id << " is already a descendant of " << *child_id << "\n";
            return std::unexpected(ErrorCode::InvalidArgument);
        }

        tx.exec_params(
            "INSERT INTO team_parents (parent_team_id, child_team_id) VALUES ($1::uuid, $2::uuid) "
            "ON CONFLICT (parent_team_id, child_team_id) DO NOTHING;",
            *parent_id, *child_id
        );
        tx.commit();
        return {};
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] TeamService::add_parent failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<void> TeamService::remove_parent(
    const std::string& child_team_id_or_name,
    const std::string& parent_team_id_or_name
) {
    if (!db_pool_) return std::unexpected(ErrorCode::DatabaseError);
    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) return std::unexpected(conn_res.error());

    try {
        pqxx::work tx(conn_res->get());
        auto child_id = resolve_team_id(tx, child_team_id_or_name);
        if (!child_id) {
            return std::unexpected(ErrorCode::NotFound);
        }
        auto parent_id = resolve_team_id(tx, parent_team_id_or_name);
        if (!parent_id) {
            return std::unexpected(ErrorCode::NotFound);
        }

        auto res = tx.exec_params(
            "DELETE FROM team_parents WHERE parent_team_id = $1::uuid AND child_team_id = $2::uuid;",
            *parent_id, *child_id
        );
        if (res.affected_rows() == 0) {
            return std::unexpected(ErrorCode::NotFound);
        }
        tx.commit();
        return {};
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] TeamService::remove_parent failed: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

} // namespace cme::admin
