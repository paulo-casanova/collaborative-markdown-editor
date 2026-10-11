/**
 * @file admin_service.hpp
 * @brief User and Team administration service for account CRUD, roles, and DAG hierarchy management.
 */

#pragma once

#include "cme/common.hpp"
#include "cme/db/connection_pool.hpp"
#include <nlohmann/json.hpp>
#include <string>
#include <vector>
#include <optional>
#include <memory>

namespace cme::admin {

/**
 * @struct UserRecord
 * @brief Persistent user entity representation.
 */
struct UserRecord {
    std::string id;
    std::string username;
    std::string display_name;
    std::string avatar_color{"#3b82f6"};
    bool is_system_admin{false};
    std::string created_at;
    std::string updated_at;

    [[nodiscard]] nlohmann::json to_json() const {
        return {
            {"id", id},
            {"username", username},
            {"display_name", display_name},
            {"avatar_color", avatar_color},
            {"is_admin", is_system_admin},
            {"created_at", created_at},
            {"updated_at", updated_at}
        };
    }
};

/**
 * @struct CreateUserRequest
 * @brief Input payload for registering a new user.
 */
struct CreateUserRequest {
    std::string username;
    std::string password;
    std::string display_name;
    std::string avatar_color{"#3b82f6"};
    bool is_system_admin{false};
};

/**
 * @struct UpdateUserRequest
 * @brief Modification parameters for updating an existing user.
 */
struct UpdateUserRequest {
    std::optional<std::string> display_name;
    std::optional<std::string> avatar_color;
    std::optional<bool> is_system_admin;
    std::optional<std::string> password;
};

/**
 * @struct TeamRecord
 * @brief Persistent team entity representation.
 */
struct TeamRecord {
    std::string id;
    std::string name;
    std::string description;
    std::string created_at;

    [[nodiscard]] nlohmann::json to_json() const {
        return {
            {"id", id},
            {"name", name},
            {"description", description},
            {"created_at", created_at}
        };
    }
};

/**
 * @struct CreateTeamRequest
 * @brief Parameters for creating a new team.
 */
struct CreateTeamRequest {
    std::string name;
    std::string description;
};

/**
 * @struct UpdateTeamRequest
 * @brief Parameters for updating team attributes.
 */
struct UpdateTeamRequest {
    std::optional<std::string> name;
    std::optional<std::string> description;
};

/**
 * @struct TeamMemberRecord
 * @brief Team membership representation associating a user and role.
 */
struct TeamMemberRecord {
    std::string team_id;
    std::string user_id;
    std::string username;
    std::string display_name;
    std::string avatar_color;
    std::string role{"member"}; // "member" or "lead"

    [[nodiscard]] nlohmann::json to_json() const {
        return {
            {"team_id", team_id},
            {"user_id", user_id},
            {"username", username},
            {"display_name", display_name},
            {"avatar_color", avatar_color},
            {"role", role}
        };
    }
};

/**
 * @class UserService
 * @brief Coordinates user account creation, credential modification, and admin elevation.
 */
class UserService {
public:
    explicit UserService(std::shared_ptr<db::ConnectionPool> db_pool);

    Result<std::vector<UserRecord>> list_users();
    Result<UserRecord> get_user_by_id(const std::string& user_id_or_username);
    Result<UserRecord> create_user(const CreateUserRequest& req);
    Result<UserRecord> update_user(const std::string& user_id_or_username, const UpdateUserRequest& req);
    Result<void> delete_user(const std::string& user_id_or_username);
    Result<void> set_admin(const std::string& user_id_or_username, bool is_admin);
    Result<void> reset_password(const std::string& user_id_or_username, const std::string& new_password);

private:
    std::shared_ptr<db::ConnectionPool> db_pool_;
};

/**
 * @class TeamService
 * @brief Coordinates team CRUD, membership assignments, and multi-parent DAG hierarchy validation.
 */
class TeamService {
public:
    explicit TeamService(std::shared_ptr<db::ConnectionPool> db_pool);

    Result<std::vector<TeamRecord>> list_teams();
    Result<TeamRecord> get_team_by_id(const std::string& team_id_or_name);
    Result<TeamRecord> create_team(const CreateTeamRequest& req);
    Result<TeamRecord> update_team(const std::string& team_id_or_name, const UpdateTeamRequest& req);
    Result<void> delete_team(const std::string& team_id_or_name);

    Result<std::vector<TeamMemberRecord>> list_members(const std::string& team_id_or_name);
    Result<void> add_member(const std::string& team_id_or_name, const std::string& user_id_or_username, const std::string& role = "member");
    Result<void> remove_member(const std::string& team_id_or_name, const std::string& user_id_or_username);

    Result<std::vector<TeamRecord>> list_parents(const std::string& team_id_or_name);
    Result<void> add_parent(const std::string& child_team_id_or_name, const std::string& parent_team_id_or_name);
    Result<void> remove_parent(const std::string& child_team_id_or_name, const std::string& parent_team_id_or_name);

private:
    std::shared_ptr<db::ConnectionPool> db_pool_;
};

} // namespace cme::admin

namespace cme::auth {
    using admin::UserService;
    using admin::TeamService;
}
