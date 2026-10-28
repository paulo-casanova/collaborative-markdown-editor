#include "cme/dialog/agent_manager.hpp"
#include <iostream>

namespace cme::dialog {

void AgentManager::register_agent(const std::string& user_id, void* ws, const std::string& agent_name) {
    std::lock_guard lock(mutex_);
    agents_[user_id] = AgentConnectionInfo{
        .ws = ws,
        .agent_name = agent_name.empty() ? "Default Local Agent" : agent_name,
        .connected_at = std::chrono::system_clock::now()
    };
    std::cout << "[INFO] [AGENT] Agent '" << agents_[user_id].agent_name 
              << "' connected for user " << user_id << "\n";
}

void AgentManager::unregister_agent(const std::string& user_id, void* ws) {
    std::lock_guard lock(mutex_);
    auto it = agents_.find(user_id);
    if (it != agents_.end()) {
        if (ws == nullptr || it->second.ws == ws) {
            std::cout << "[INFO] [AGENT] Agent disconnected for user " << user_id << "\n";
            agents_.erase(it);
        }
    }
}

bool AgentManager::is_agent_online(const std::string& user_id) const {
    std::lock_guard lock(mutex_);
    return agents_.find(user_id) != agents_.end();
}

std::string AgentManager::get_agent_name(const std::string& user_id) const {
    std::lock_guard lock(mutex_);
    auto it = agents_.find(user_id);
    if (it != agents_.end()) {
        return it->second.agent_name;
    }
    return "";
}

size_t AgentManager::active_agent_count() const {
    std::lock_guard lock(mutex_);
    return agents_.size();
}

bool AgentManager::send_to_agent(const std::string& user_id, const std::string& message) {
    PublishAgentFn fn_copy;
    {
        std::lock_guard lock(mutex_);
        if (agents_.find(user_id) == agents_.end()) {
            return false;
        }
        fn_copy = publish_agent_fn_;
    }

    if (fn_copy) {
        fn_copy(user_id, message);
        return true;
    }
    return false;
}

void AgentManager::send_to_dialog(const std::string& dialog_id, const std::string& message) {
    PublishDialogFn fn_copy;
    {
        std::lock_guard lock(mutex_);
        fn_copy = publish_dialog_fn_;
    }

    if (fn_copy) {
        fn_copy(dialog_id, message);
    }
}

} // namespace cme::dialog
