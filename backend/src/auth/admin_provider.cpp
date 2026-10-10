#include "cme/auth/admin_provider.hpp"
#include <fstream>
#include <sstream>
#include <iostream>
#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <sys/wait.h>

namespace cme::auth {

namespace {

std::string trim_string(std::string_view sv) {
    while (!sv.empty() && std::isspace(static_cast<unsigned char>(sv.front()))) {
        sv.remove_prefix(1);
    }
    while (!sv.empty() && std::isspace(static_cast<unsigned char>(sv.back()))) {
        sv.remove_suffix(1);
    }
    return std::string(sv);
}

std::string to_lower_copy(std::string_view sv) {
    std::string result;
    result.reserve(sv.size());
    for (char c : sv) {
        result.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }
    return result;
}

bool is_safe_username(std::string_view u) {
    if (u.empty() || u.size() > 64) return false;
    for (char c : u) {
        if (!std::isalnum(static_cast<unsigned char>(c)) && c != '_' && c != '-' && c != '.') {
            return false;
        }
    }
    return true;
}

} // namespace

// =============================================================================
// FileAdminProvider Implementation
// =============================================================================

FileAdminProvider::FileAdminProvider(std::string file_path)
    : file_path_(std::move(file_path)) {
    reload();
}

void FileAdminProvider::reload() {
    std::lock_guard lock(mutex_);
    reload_unlocked();
}

void FileAdminProvider::reload_unlocked() {
    admin_users_.clear();

    std::error_code ec;
    if (!std::filesystem::exists(file_path_, ec)) {
        return;
    }

    last_mtime_ = std::filesystem::last_write_time(file_path_, ec);
    if (ec) {
        return;
    }

    std::ifstream file(file_path_);
    if (!file.is_open()) {
        return;
    }

    std::string line;
    while (std::getline(file, line)) {
        // Strip comments starting with '#'
        auto comment_pos = line.find('#');
        if (comment_pos != std::string::npos) {
            line = line.substr(0, comment_pos);
        }

        std::string trimmed = trim_string(line);
        if (trimmed.empty()) {
            continue;
        }

        // Check if CSV format
        auto comma_pos = trimmed.find(',');
        if (comma_pos != std::string::npos) {
            std::string user_col = trim_string(trimmed.substr(0, comma_pos));
            std::string flag_col = to_lower_copy(trim_string(trimmed.substr(comma_pos + 1)));

            if (user_col == "username") {
                // Header row
                continue;
            }

            if (flag_col == "true" || flag_col == "1" || flag_col == "admin" || flag_col == "yes") {
                admin_users_.insert(user_col);
            }
        } else {
            // Line-delimited username
            admin_users_.insert(trimmed);
        }
    }
}

bool FileAdminProvider::is_admin(const std::string& username) {
    std::lock_guard lock(mutex_);

    // Hot-reload if file modification timestamp has changed
    std::error_code ec;
    if (std::filesystem::exists(file_path_, ec)) {
        auto mtime = std::filesystem::last_write_time(file_path_, ec);
        if (!ec && mtime != last_mtime_) {
            reload_unlocked();
        }
    }

    return admin_users_.contains(username);
}

// =============================================================================
// CommandAdminProvider Implementation
// =============================================================================

CommandAdminProvider::CommandAdminProvider(
    std::string command_template,
    std::chrono::seconds cache_ttl
) : command_template_(std::move(command_template)),
    cache_ttl_(cache_ttl) {}

void CommandAdminProvider::clear_cache() {
    std::lock_guard lock(mutex_);
    cache_.clear();
}

bool CommandAdminProvider::execute_command(const std::string& username) {
    if (!is_safe_username(username)) {
        return false;
    }

    std::string cmd;
    size_t placeholder = command_template_.find("%USER%");
    if (placeholder != std::string::npos) {
        cmd = command_template_;
        cmd.replace(placeholder, 6, username);
    } else {
        cmd = command_template_ + " " + username;
    }

    int status = std::system(cmd.c_str());
    if (status == -1) {
        return false;
    }

    return (WIFEXITED(status) && WEXITSTATUS(status) == 0);
}

bool CommandAdminProvider::is_admin(const std::string& username) {
    auto now = std::chrono::steady_clock::now();
    {
        std::lock_guard lock(mutex_);
        auto it = cache_.find(username);
        if (it != cache_.end() && it->second.expires_at > now) {
            return it->second.is_admin;
        }
    }

    bool admin = execute_command(username);

    {
        std::lock_guard lock(mutex_);
        cache_[username] = CacheEntry{
            .is_admin = admin,
            .expires_at = now + cache_ttl_
        };
    }

    return admin;
}

// =============================================================================
// Factory Implementation
// =============================================================================

std::shared_ptr<IAdminProvider> create_admin_provider(const config::AuthZConfig& config) {
    if (config.admin_provider == "command") {
        return std::make_shared<CommandAdminProvider>(config.admin_command);
    }
    return std::make_shared<FileAdminProvider>(config.admin_file_path);
}

} // namespace cme::auth
