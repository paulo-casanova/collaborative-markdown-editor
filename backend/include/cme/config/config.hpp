/**
 * @file config.hpp
 * @brief Configuration data structures and multi-tier precedence resolution loader.
 */

#pragma once

#include <string>
#include <cstdint>
#include <optional>
#include <unordered_map>
#include <vector>
#include <cctype>
#include "cme/common.hpp"

namespace cme::config {

struct ServerConfig {
    std::string bind{"0.0.0.0"};
    int port{8080};
    int reactor_threads{2};
    int worker_threads{8};
    uint64_t max_payload_bytes{33554432}; // 32 MB
    int keepalive_timeout_seconds{120};   // WebSocket idle & keepalive ping timeout (0 or 8-960 seconds)
    std::vector<std::string> cors_allowed_origins{}; // Empty by default = CORS disabled
};

struct StorageMountConfig {
    std::string prefix{""}; // Workspace virtual path prefix, e.g. "specs", "notes"
    std::string path{""};   // Host filesystem target path, e.g. "/var/data/specs"
};

struct StorageConfig {
    std::string backend{"posix"}; // "posix", "s3"
    std::string root_path{"/var/lib/cme/storage"};
    int trash_retention_days{30};
    int snapshot_interval_seconds{300};
    std::vector<StorageMountConfig> mounts{}; // Additional explicit host filesystem directory mounts

    // S3 / Object Storage configuration
    std::string s3_bucket{""};
    std::string s3_region{"us-east-1"};
    std::string s3_endpoint{""}; // Custom endpoint for MinIO, LocalStack, Cloudflare R2, Ceph
    std::string s3_prefix{""};   // Optional key prefix within the bucket
    std::string s3_access_key{""};
    std::string s3_secret_key{""};
    bool s3_force_path_style{true}; // Useful for MinIO / self-hosted S3 endpoints
};

struct DatabaseConfig {
    std::string url{"postgresql://cme:secret@localhost:5432/cme_test"};
    size_t pool_size{8};
    int connect_timeout_seconds{5};
    bool lease_enabled{true};
    std::string lease_name{"cme_server"};
    int lease_ttl_seconds{10};
    int lease_renew_interval_seconds{3};
    bool lease_wait{true};                         // If true, server waits for lease on startup instead of failing immediately
    int lease_retry_interval_seconds{1};           // Polling interval in seconds while waiting for lease
    int lease_acquire_timeout_seconds{0};          // Maximum wait time in seconds (0 = wait indefinitely)
};

struct AuthNConfig {
    std::string provider{"delegated"}; // "challenge" or "delegated"
    std::string delegated_header{"X-Remote-User"};
    std::string delegated_email_header{"X-Remote-Email"};
    int session_ttl_hours{72};

    // Reverse-proxy verification headers for delegated authentication
    std::string proxy_secret_header{""}; // e.g., "X-Proxy-Secret"
    std::string proxy_secret_value{""};  // e.g., "shared-secret-123"
    std::unordered_map<std::string, std::string> required_headers{}; // Arbitrary headers that must exist and match

    [[nodiscard]] std::unordered_map<std::string, std::string> get_effective_required_headers() const {
        std::unordered_map<std::string, std::string> result;
        for (const auto& [k, v] : required_headers) {
            std::string lk = k;
            for (auto& c : lk) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
            result[lk] = v;
        }
        if (!proxy_secret_header.empty() && !proxy_secret_value.empty()) {
            std::string lk = proxy_secret_header;
            for (auto& c : lk) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
            result[lk] = proxy_secret_value;
        }
        return result;
    }
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

struct SnippetEndpointConfig {
    std::string url{""};
    std::string curl_args{""};
};

struct SnippetsConfig {
    std::vector<std::string> allowed_hosts{};
    std::string default_curl_args{""};
    std::unordered_map<std::string, SnippetEndpointConfig> endpoints{};
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
    SnippetsConfig snippets;

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
