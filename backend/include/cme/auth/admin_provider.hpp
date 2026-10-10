/**
 * @file admin_provider.hpp
 * @brief Pluggable administrative privilege evaluation interface and providers.
 */

#pragma once

#include <string>
#include <unordered_set>
#include <unordered_map>
#include <mutex>
#include <chrono>
#include <filesystem>
#include <memory>
#include "cme/config/config.hpp"

namespace cme::auth {

/**
 * @class IAdminProvider
 * @brief Abstract interface evaluating high-level superuser administrative privileges.
 */
class IAdminProvider {
public:
    virtual ~IAdminProvider() = default;

    /**
     * @brief Checks whether the specified username possesses superuser administrative rights.
     * @param username Alphanumeric username string.
     * @return True if granted superuser privileges, false otherwise.
     */
    [[nodiscard]] virtual bool is_admin(const std::string& username) = 0;
};

/**
 * @class FileAdminProvider
 * @brief File-based admin provider reading line-delimited or CSV files (e.g., admins.txt, users.csv).
 * Supports automatic hot-reloading when the underlying file timestamp changes.
 */
class FileAdminProvider : public IAdminProvider {
public:
    explicit FileAdminProvider(std::string file_path);

    [[nodiscard]] bool is_admin(const std::string& username) override;

    /**
     * @brief Forces an immediate cache refresh from disk.
     */
    void reload();

private:
    std::string file_path_;
    mutable std::mutex mutex_;
    std::unordered_set<std::string> admin_users_;
    std::filesystem::file_time_type last_mtime_{};

    void reload_unlocked();
};

/**
 * @class CommandAdminProvider
 * @brief Command-based admin provider executing external CLI tools/scripts with in-memory caching.
 */
class CommandAdminProvider : public IAdminProvider {
public:
    explicit CommandAdminProvider(
        std::string command_template,
        std::chrono::seconds cache_ttl = std::chrono::seconds(60)
    );

    [[nodiscard]] bool is_admin(const std::string& username) override;

    /**
     * @brief Purges cached admin evaluation entries.
     */
    void clear_cache();

private:
    struct CacheEntry {
        bool is_admin{false};
        std::chrono::steady_clock::time_point expires_at;
    };

    std::string command_template_;
    std::chrono::seconds cache_ttl_;
    mutable std::mutex mutex_;
    std::unordered_map<std::string, CacheEntry> cache_;

    bool execute_command(const std::string& username);
};

/**
 * @brief Factory function constructing an IAdminProvider based on AuthZConfig settings.
 */
[[nodiscard]] std::shared_ptr<IAdminProvider> create_admin_provider(const config::AuthZConfig& config);

} // namespace cme::auth
