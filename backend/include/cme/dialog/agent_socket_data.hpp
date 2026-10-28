/**
 * @file agent_socket_data.hpp
 * @brief User data attached to active local agent and dialog WebSocket descriptors.
 */

#pragma once

#include <string>
#include <chrono>

namespace cme::dialog {

/**
 * @struct AgentSocketData
 * @brief State attached to a connected local agent WebSocket.
 */
struct AgentSocketData {
    std::string user_id;
    std::string agent_name{"Default Local Agent"};
    std::string topic;
    std::chrono::system_clock::time_point connected_at{std::chrono::system_clock::now()};
};

/**
 * @struct DialogSocketData
 * @brief State attached to a browser client listening to dialog streaming events.
 */
struct DialogSocketData {
    std::string user_id;
    std::string dialog_id;
    std::string topic;
};

} // namespace cme::dialog
