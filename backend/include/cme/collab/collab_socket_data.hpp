/**
 * @file collab_socket_data.hpp
 * @brief Per-socket contextual metadata stored in uWebSockets connection state.
 */

#pragma once

#include "cme/db/permission_engine.hpp"
#include <string>

namespace cme::collab {

/**
 * @struct CollabSocketData
 * @brief Per-socket contextual metadata stored in uWebSockets connection state.
 */
struct CollabSocketData {
    std::string document_id;
    std::string topic;
    std::string client_id;
    std::string user_id;
    std::string username;
    std::string display_name;
    std::string avatar_color{"#3b82f6"};
    bool is_authenticated{false};
    bool is_admin{false};
    db::AccessLevel access_level{db::AccessLevel::Read};
};

} // namespace cme::collab
