/**
 * @file agent_manager.hpp
 * @brief Thread-safe registry and message dispatcher for connected local agents.
 */

#pragma once

#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include <mutex>
#include <functional>
#include <chrono>
#include <optional>
#include <nlohmann/json.hpp>

namespace cme::dialog {

/**
 * @struct AgentConnectionInfo
 * @brief Active connection metadata for a user's local agent.
 */
struct AgentConnectionInfo {
    void* ws{nullptr};
    std::string agent_name{"Default Local Agent"};
    std::chrono::system_clock::time_point connected_at{std::chrono::system_clock::now()};
};

/**
 * @class AgentManager
 * @brief Coordinates active agent sessions, presence tracking, and outbound request routing.
 */
class AgentManager {
public:
    using PublishAgentFn = std::function<void(const std::string& user_id, const std::string& message)>;
    using PublishDialogFn = std::function<void(const std::string& dialog_id, const std::string& message)>;

    AgentManager() = default;

    /**
     * @brief Registers an agent WebSocket connection for a given user.
     */
    void register_agent(const std::string& user_id, void* ws, const std::string& agent_name);

    /**
     * @brief Unregisters an agent WebSocket connection when terminated.
     */
    void unregister_agent(const std::string& user_id, void* ws);

    /**
     * @brief Checks if an agent is currently online and connected for a user.
     */
    [[nodiscard]] bool is_agent_online(const std::string& user_id) const;

    /**
     * @brief Returns the name of the active agent for a user, or empty string.
     */
    [[nodiscard]] std::string get_agent_name(const std::string& user_id) const;

    /**
     * @brief Returns total count of currently connected agents.
     */
    [[nodiscard]] size_t active_agent_count() const;

    /**
     * @brief Sets publisher callback for dispatching messages to an agent's pub/sub topic.
     */
    void set_publish_to_agent_fn(PublishAgentFn fn) {
        publish_agent_fn_ = std::move(fn);
    }

    /**
     * @brief Sets publisher callback for dispatching messages to a dialog's pub/sub topic.
     */
    void set_publish_to_dialog_fn(PublishDialogFn fn) {
        publish_dialog_fn_ = std::move(fn);
    }

    /**
     * @brief Sends a JSON payload to a user's active local agent.
     * @return True if agent was online and message was queued, false otherwise.
     */
    bool send_to_agent(const std::string& user_id, const std::string& message);

    /**
     * @brief Broadcasts a JSON event payload to all clients listening to a dialog thread.
     */
    void send_to_dialog(const std::string& dialog_id, const std::string& message);

    /**
     * @brief Marks that a prompt has started for a dialog and user.
     */
    void track_prompt_started(const std::string& user_id, const std::string& dialog_id);

    /**
     * @brief Marks that a prompt has completed or terminated for a dialog.
     */
    void track_prompt_completed(const std::string& dialog_id);

    /**
     * @brief Checks if a dialog currently has an active prompt running.
     */
    [[nodiscard]] bool is_prompt_pending(const std::string& dialog_id) const;

    /**
     * @brief Clears and returns all pending dialog_ids for a user (e.g. upon agent disconnect).
     */
    std::vector<std::string> get_and_clear_pending_dialogs(const std::string& user_id);

private:
    mutable std::mutex mutex_;
    std::unordered_map<std::string, AgentConnectionInfo> agents_;
    std::unordered_map<std::string, std::string> active_dialog_prompts_;
    std::unordered_map<std::string, std::unordered_set<std::string>> user_active_dialogs_;
    PublishAgentFn publish_agent_fn_;
    PublishDialogFn publish_dialog_fn_;
};

} // namespace cme::dialog
