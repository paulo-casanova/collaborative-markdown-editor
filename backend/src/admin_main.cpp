#include "cme/admin/admin_service.hpp"
#include "cme/version.hpp"
#include "cme/db/connection_pool.hpp"
#include <iostream>
#include <iomanip>
#include <string>
#include <vector>
#include <cstdlib>

using namespace cme;
using namespace cme::admin;

namespace {

void print_help() {
    std::cout << format_version_banner() << " - Administration CLI (cme-admin)\n\n"
              << "Usage: cme-admin [--db <connstring>] <command> <action> [options]\n\n"
              << "Global Options:\n"
              << "  --db <connstring>       PostgreSQL connection URL (or CME_DATABASE_URL env)\n"
              << "  -h, --help              Display this help message\n\n"
              << "Commands:\n"
              << "  user list               List all registered users\n"
              << "  user get <user_or_id>   View details of a user\n"
              << "  user create             Create a new user account\n"
              << "                          --username <name> --password <pass> [--display-name <name>] [--avatar <#hex>] [--admin]\n"
              << "  user set-admin          Grant or revoke system admin privilege\n"
              << "                          --username <name> [--revoke]\n"
              << "  user reset-password     Update user password\n"
              << "                          --username <name> --password <pass>\n"
              << "  user delete             Delete a user account\n"
              << "                          --username <name>\n\n"
              << "  team list               List all teams\n"
              << "  team get <team_or_id>   View details of a team\n"
              << "  team create             Create a new team\n"
              << "                          --name <name> [--description <desc>]\n"
              << "  team delete             Delete a team\n"
              << "                          --team <name_or_id>\n"
              << "  team add-member         Add a user to a team\n"
              << "                          --team <team> --user <user> [--role member|lead]\n"
              << "  team remove-member      Remove a user from a team\n"
              << "                          --team <team> --user <user>\n"
              << "  team list-members       List all members in a team\n"
              << "                          --team <team>\n"
              << "  team add-parent         Link parent team in DAG hierarchy\n"
              << "                          --team <child_team> --parent <parent_team>\n"
              << "  team remove-parent      Unlink parent team from DAG hierarchy\n"
              << "                          --team <child_team> --parent <parent_team>\n"
              << "  team list-parents       List direct parent teams\n"
              << "                          --team <child_team>\n";
}

std::string get_opt(const std::vector<std::string>& args, const std::string& opt, const std::string& def = "") {
    for (size_t i = 0; i < args.size(); ++i) {
        if (args[i] == opt && i + 1 < args.size()) {
            return args[i + 1];
        }
    }
    return def;
}

bool has_flag(const std::vector<std::string>& args, const std::string& flag) {
    for (const auto& a : args) {
        if (a == flag) return true;
    }
    return false;
}

} // namespace

int main(int argc, char* argv[]) {
    std::string db_url = "postgresql://cme:secret@localhost:5432/cme_test";
    if (const char* env_db = std::getenv("CME_DATABASE_URL")) {
        db_url = env_db;
    }

    std::vector<std::string> args;
    args.reserve(static_cast<size_t>(argc));
    for (int i = 1; i < argc; ++i) {
        std::string s = argv[i];
        if (s == "--db" && i + 1 < argc) {
            db_url = argv[++i];
        } else {
            args.push_back(s);
        }
    }

    if (args.empty() || has_flag(args, "--help") || has_flag(args, "-h")) {
        print_help();
        return 0;
    }

    std::shared_ptr<db::ConnectionPool> pool;
    try {
        pool = db::ConnectionPool::create(db_url, 2);
    } catch (const std::exception& e) {
        std::cerr << "[FATAL] Failed to connect to database at " << db_url << ": " << e.what() << "\n";
        return 1;
    }

    UserService user_service(pool);
    TeamService team_service(pool);

    std::string command = args[0];
    std::string action = (args.size() > 1) ? args[1] : "";

    // --------------------------------------------------------------------------
    // USER COMMANDS
    // --------------------------------------------------------------------------
    if (command == "user") {
        if (action == "list") {
            auto res = user_service.list_users();
            if (!res) {
                std::cerr << "[ERROR] Failed to list users: " << to_string(res.error()) << "\n";
                return 1;
            }
            std::cout << std::left << std::setw(38) << "ID"
                      << std::setw(20) << "USERNAME"
                      << std::setw(25) << "DISPLAY NAME"
                      << std::setw(8) << "ADMIN"
                      << "\n";
            std::cout << std::string(91, '-') << "\n";
            for (const auto& u : *res) {
                std::cout << std::left << std::setw(38) << u.id
                          << std::setw(20) << u.username
                          << std::setw(25) << u.display_name
                          << std::setw(8) << (u.is_system_admin ? "YES" : "NO")
                          << "\n";
            }
            return 0;
        }

        if (action == "get") {
            std::string id = (args.size() > 2) ? args[2] : get_opt(args, "--username");
            if (id.empty()) {
                std::cerr << "[ERROR] Missing user identifier. Usage: cme-admin user get <user_or_id>\n";
                return 1;
            }
            auto res = user_service.get_user_by_id(id);
            if (!res) {
                std::cerr << "[ERROR] User not found: " << id << "\n";
                return 1;
            }
            std::cout << res->to_json().dump(2) << "\n";
            return 0;
        }

        if (action == "create") {
            std::string username = get_opt(args, "--username");
            std::string password = get_opt(args, "--password");
            std::string display_name = get_opt(args, "--display-name", username);
            std::string avatar = get_opt(args, "--avatar", "#3b82f6");
            bool is_admin = has_flag(args, "--admin");

            if (username.empty() || password.empty()) {
                std::cerr << "[ERROR] --username and --password are required.\n";
                return 1;
            }

            CreateUserRequest req{
                .username = username,
                .password = password,
                .display_name = display_name,
                .avatar_color = avatar,
                .is_system_admin = is_admin
            };

            auto res = user_service.create_user(req);
            if (!res) {
                std::cerr << "[ERROR] Failed to create user: " << to_string(res.error()) << "\n";
                return 1;
            }
            std::cout << "[SUCCESS] Created user '" << res->username << "' (ID: " << res->id << ")\n";
            return 0;
        }

        if (action == "set-admin") {
            std::string username = get_opt(args, "--username");
            if (username.empty() && args.size() > 2) username = args[2];
            if (username.empty()) {
                std::cerr << "[ERROR] --username is required.\n";
                return 1;
            }
            bool is_admin = !has_flag(args, "--revoke");
            auto res = user_service.set_admin(username, is_admin);
            if (!res) {
                std::cerr << "[ERROR] Failed to update admin privilege: " << to_string(res.error()) << "\n";
                return 1;
            }
            std::cout << "[SUCCESS] User '" << username << "' admin privilege set to: " << (is_admin ? "TRUE" : "FALSE") << "\n";
            return 0;
        }

        if (action == "reset-password") {
            std::string username = get_opt(args, "--username");
            std::string password = get_opt(args, "--password");
            if (username.empty() || password.empty()) {
                std::cerr << "[ERROR] --username and --password are required.\n";
                return 1;
            }
            auto res = user_service.reset_password(username, password);
            if (!res) {
                std::cerr << "[ERROR] Failed to reset password: " << to_string(res.error()) << "\n";
                return 1;
            }
            std::cout << "[SUCCESS] Password reset for user '" << username << "'.\n";
            return 0;
        }

        if (action == "delete") {
            std::string username = get_opt(args, "--username");
            if (username.empty() && args.size() > 2) username = args[2];
            if (username.empty()) {
                std::cerr << "[ERROR] --username is required.\n";
                return 1;
            }
            auto res = user_service.delete_user(username);
            if (!res) {
                std::cerr << "[ERROR] Failed to delete user: " << to_string(res.error()) << "\n";
                return 1;
            }
            std::cout << "[SUCCESS] Deleted user '" << username << "'.\n";
            return 0;
        }

        std::cerr << "[ERROR] Unknown user action: " << action << "\n";
        return 1;
    }

    // --------------------------------------------------------------------------
    // TEAM COMMANDS
    // --------------------------------------------------------------------------
    if (command == "team") {
        if (action == "list") {
            auto res = team_service.list_teams();
            if (!res) {
                std::cerr << "[ERROR] Failed to list teams: " << to_string(res.error()) << "\n";
                return 1;
            }
            std::cout << std::left << std::setw(38) << "ID"
                      << std::setw(28) << "NAME"
                      << std::setw(35) << "DESCRIPTION"
                      << "\n";
            std::cout << std::string(101, '-') << "\n";
            for (const auto& t : *res) {
                std::cout << std::left << std::setw(38) << t.id
                          << std::setw(28) << t.name
                          << std::setw(35) << t.description
                          << "\n";
            }
            return 0;
        }

        if (action == "get") {
            std::string team = (args.size() > 2) ? args[2] : get_opt(args, "--team");
            if (team.empty()) {
                std::cerr << "[ERROR] Missing team identifier. Usage: cme-admin team get <team_or_id>\n";
                return 1;
            }
            auto res = team_service.get_team_by_id(team);
            if (!res) {
                std::cerr << "[ERROR] Team not found: " << team << "\n";
                return 1;
            }
            std::cout << res->to_json().dump(2) << "\n";
            return 0;
        }

        if (action == "create") {
            std::string name = get_opt(args, "--name");
            std::string desc = get_opt(args, "--description");
            if (name.empty()) {
                std::cerr << "[ERROR] --name is required.\n";
                return 1;
            }
            auto res = team_service.create_team(CreateTeamRequest{.name = name, .description = desc});
            if (!res) {
                std::cerr << "[ERROR] Failed to create team: " << to_string(res.error()) << "\n";
                return 1;
            }
            std::cout << "[SUCCESS] Created team '" << res->name << "' (ID: " << res->id << ")\n";
            return 0;
        }

        if (action == "delete") {
            std::string team = get_opt(args, "--team");
            if (team.empty() && args.size() > 2) team = args[2];
            if (team.empty()) {
                std::cerr << "[ERROR] --team is required.\n";
                return 1;
            }
            auto res = team_service.delete_team(team);
            if (!res) {
                std::cerr << "[ERROR] Failed to delete team: " << to_string(res.error()) << "\n";
                return 1;
            }
            std::cout << "[SUCCESS] Deleted team '" << team << "'.\n";
            return 0;
        }

        if (action == "add-member") {
            std::string team = get_opt(args, "--team");
            std::string user = get_opt(args, "--user");
            std::string role = get_opt(args, "--role", "member");
            if (team.empty() || user.empty()) {
                std::cerr << "[ERROR] --team and --user are required.\n";
                return 1;
            }
            auto res = team_service.add_member(team, user, role);
            if (!res) {
                std::cerr << "[ERROR] Failed to add member: " << to_string(res.error()) << "\n";
                return 1;
            }
            std::cout << "[SUCCESS] Added user '" << user << "' to team '" << team << "' as '" << role << "'.\n";
            return 0;
        }

        if (action == "remove-member") {
            std::string team = get_opt(args, "--team");
            std::string user = get_opt(args, "--user");
            if (team.empty() || user.empty()) {
                std::cerr << "[ERROR] --team and --user are required.\n";
                return 1;
            }
            auto res = team_service.remove_member(team, user);
            if (!res) {
                std::cerr << "[ERROR] Failed to remove member: " << to_string(res.error()) << "\n";
                return 1;
            }
            std::cout << "[SUCCESS] Removed user '" << user << "' from team '" << team << "'.\n";
            return 0;
        }

        if (action == "list-members") {
            std::string team = get_opt(args, "--team");
            if (team.empty() && args.size() > 2) team = args[2];
            if (team.empty()) {
                std::cerr << "[ERROR] --team is required.\n";
                return 1;
            }
            auto res = team_service.list_members(team);
            if (!res) {
                std::cerr << "[ERROR] Failed to list team members: " << to_string(res.error()) << "\n";
                return 1;
            }
            std::cout << std::left << std::setw(20) << "USERNAME"
                      << std::setw(25) << "DISPLAY NAME"
                      << std::setw(12) << "ROLE"
                      << "\n";
            std::cout << std::string(57, '-') << "\n";
            for (const auto& m : *res) {
                std::cout << std::left << std::setw(20) << m.username
                          << std::setw(25) << m.display_name
                          << std::setw(12) << m.role
                          << "\n";
            }
            return 0;
        }

        if (action == "add-parent") {
            std::string team = get_opt(args, "--team");
            std::string parent = get_opt(args, "--parent");
            if (team.empty() || parent.empty()) {
                std::cerr << "[ERROR] --team and --parent are required.\n";
                return 1;
            }
            auto res = team_service.add_parent(team, parent);
            if (!res) {
                std::cerr << "[ERROR] Failed to link parent team: " << to_string(res.error())
                          << " (ensure teams exist and no cycles are formed)\n";
                return 1;
            }
            std::cout << "[SUCCESS] Linked parent team '" << parent << "' to child team '" << team << "'.\n";
            return 0;
        }

        if (action == "remove-parent") {
            std::string team = get_opt(args, "--team");
            std::string parent = get_opt(args, "--parent");
            if (team.empty() || parent.empty()) {
                std::cerr << "[ERROR] --team and --parent are required.\n";
                return 1;
            }
            auto res = team_service.remove_parent(team, parent);
            if (!res) {
                std::cerr << "[ERROR] Failed to unlink parent team: " << to_string(res.error()) << "\n";
                return 1;
            }
            std::cout << "[SUCCESS] Unlinked parent team '" << parent << "' from child team '" << team << "'.\n";
            return 0;
        }

        if (action == "list-parents") {
            std::string team = get_opt(args, "--team");
            if (team.empty() && args.size() > 2) team = args[2];
            if (team.empty()) {
                std::cerr << "[ERROR] --team is required.\n";
                return 1;
            }
            auto res = team_service.list_parents(team);
            if (!res) {
                std::cerr << "[ERROR] Failed to list parent teams: " << to_string(res.error()) << "\n";
                return 1;
            }
            std::cout << std::left << std::setw(38) << "PARENT ID"
                      << std::setw(28) << "NAME"
                      << "\n";
            std::cout << std::string(66, '-') << "\n";
            for (const auto& p : *res) {
                std::cout << std::left << std::setw(38) << p.id
                          << std::setw(28) << p.name
                          << "\n";
            }
            return 0;
        }

        std::cerr << "[ERROR] Unknown team action: " << action << "\n";
        return 1;
    }

    std::cerr << "[ERROR] Unknown command: " << command << ". Run with --help for usage.\n";
    return 1;
}
