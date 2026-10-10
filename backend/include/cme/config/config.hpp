/**
 * @file config.hpp
 * @brief Configuration data structures and multi-tier precedence resolution loader.
 */

#pragma once

#include <string>
#include <cstdint>
#include <optional>
#include "cme/common.hpp"

namespace cme::config {

struct ServerConfig {
    std::string bind{"0.0.0.0"};
    int port{8080};
    int reactor_threads{2};
    int worker_threads{8};
    uint64_t max_payload_bytes{33554432}; // 32 MB
};

struct StorageConfig {
    std::string backend{"posix"};
    std::string root_path{"/var/lib/cme/storage"};
    int trash_retention_days{30};
    int snapshot_interval_seconds{300};
};

struct DatabaseConfig {
    std::string url{"postgresql://cme:secret@localhost:5432/cme_test"};
    size_t pool_size{8};
    int connect_timeout_seconds{5};
};

struct AuthNConfig {
    std::string provider{"delegated"}; // "challenge" or "delegated"
    std::string delegated_header{"X-Remote-User"};
    std::string delegated_email_header{"X-Remote-Email"};
    int session_ttl_hours{72};
};

struct AuthZConfig {
    std::string admin_provider{"file"}; // "file" or "command"
    std::string admin_file_path{"/etc/cme/admins.txt"};
    std::string admin_command{"/usr/local/bin/check_admin.sh %USER%"};
};

struct UIConfig {
    bool embedded{false};
    std::string dist_dir{""};
};

struct BackupConfig {
    bool enabled{true};
    std::string cron_schedule{"0 2 * * *"};
    std::string script_path{"/usr/local/bin/cme-backup.sh"};
    std::string target_dir{"/var/lib/cme/storage/backups"};
    int retention_daily{7};
    int retention_weekly{4};
};

struct LoggingConfig {
    std::string level{"info"};
    std::string format{"json"};
};

/**
 * @struct AppConfig
 * @brief Master runtime configuration container.
 */
struct AppConfig {
    std::string config_file_path{"/etc/cme/config.yaml"};
    bool verify_integrity_only{false};

    ServerConfig server;
    StorageConfig storage;
    DatabaseConfig database;
    AuthNConfig authn;
    AuthZConfig authz;
    UIConfig ui;
    BackupConfig backup;
    LoggingConfig logging;

    /**
     * @brief Loads and merges configuration following the precedence waterfall:
     * CLI Flags > Environment Variables > YAML File > Compiled Defaults.
     */
    static Result<AppConfig> load(int argc, char* argv[]);

    /**
     * @brief Loads configuration from a specified YAML file.
     */
    static Result<AppConfig> from_yaml_file(const std::string& path);
};

} // namespace cme::config
