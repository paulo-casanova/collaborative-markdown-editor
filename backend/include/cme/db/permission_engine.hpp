#pragma once

#include <string>
#include <vector>
#include <string_view>
#include <optional>
#include <pqxx/pqxx>
#include "cme/common.hpp"

namespace cme::db {

enum class AccessLevel : uint8_t {
    None = 0,
    Read = 1,
    Comment = 2,
    Edit = 3,
    Admin = 4
};

[[nodiscard]] constexpr std::string_view to_string(AccessLevel level) noexcept {
    switch (level) {
        case AccessLevel::None: return "NONE";
        case AccessLevel::Read: return "READ";
        case AccessLevel::Comment: return "COMMENT";
        case AccessLevel::Edit: return "EDIT";
        case AccessLevel::Admin: return "ADMIN";
    }
    return "NONE";
}

[[nodiscard]] constexpr AccessLevel parse_access_level(std::string_view str) noexcept {
    if (str == "READ") return AccessLevel::Read;
    if (str == "COMMENT") return AccessLevel::Comment;
    if (str == "EDIT") return AccessLevel::Edit;
    if (str == "ADMIN") return AccessLevel::Admin;
    return AccessLevel::None;
}

class PermissionEngine {
public:
    static Result<std::vector<std::string>> get_effective_teams(
        pqxx::connection& conn,
        const std::string& user_id
    );

    static Result<AccessLevel> check_permission(
        pqxx::connection& conn,
        const std::string& user_id,
        const std::string& document_id,
        const std::string& fs_path
    );
};

} // namespace cme::db
