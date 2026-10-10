#include "cme/config/config.hpp"
#include <yaml-cpp/yaml.h>
#include <filesystem>
#include <iostream>
#include <cstdlib>

namespace cme::config {

namespace {

void apply_env_overrides(AppConfig& cfg) {
    if (const char* v = std::getenv("CME_SERVER_BIND")) cfg.server.bind = v;
    if (const char* v = std::getenv("CME_SERVER_PORT")) cfg.server.port = std::stoi(v);
    if (const char* v = std::getenv("CME_STORAGE_ROOT_PATH")) cfg.storage.root_path = v;
    if (const char* v = std::getenv("CME_DATABASE_URL")) cfg.database.url = v;
    if (const char* v = std::getenv("CME_AUTHN_PROVIDER")) cfg.authn.provider = v;
    if (const char* v = std::getenv("CME_AUTHN_DELEGATED_HEADER")) cfg.authn.delegated_header = v;
    if (const char* v = std::getenv("CME_AUTHZ_ADMIN_PROVIDER")) cfg.authz.admin_provider = v;
    if (const char* v = std::getenv("CME_AUTHZ_ADMIN_COMMAND")) cfg.authz.admin_command = v;
    if (const char* v = std::getenv("CME_LOGGING_LEVEL")) cfg.logging.level = v;
    if (const char* v = std::getenv("CME_UI_EMBEDDED")) cfg.ui.embedded = (std::string(v) == "true" || std::string(v) == "1");
    if (const char* v = std::getenv("CME_UI_DIST_DIR")) cfg.ui.dist_dir = v;
}

void parse_yaml_node(const YAML::Node& root, AppConfig& cfg) {
    if (!root.IsDefined() || !root.IsMap()) return;

    if (root["server"]) {
        auto s = root["server"];
        if (s["bind"]) cfg.server.bind = s["bind"].as<std::string>();
        if (s["port"]) cfg.server.port = s["port"].as<int>();
        if (s["reactor_threads"]) cfg.server.reactor_threads = s["reactor_threads"].as<int>();
        if (s["worker_threads"]) cfg.server.worker_threads = s["worker_threads"].as<int>();
        if (s["max_payload_bytes"]) cfg.server.max_payload_bytes = s["max_payload_bytes"].as<uint64_t>();
    }

    if (root["storage"]) {
        auto st = root["storage"];
        if (st["backend"]) cfg.storage.backend = st["backend"].as<std::string>();
        if (st["root_path"]) cfg.storage.root_path = st["root_path"].as<std::string>();
        if (st["trash_retention_days"]) cfg.storage.trash_retention_days = st["trash_retention_days"].as<int>();
        if (st["snapshot_interval_seconds"]) cfg.storage.snapshot_interval_seconds = st["snapshot_interval_seconds"].as<int>();
    }

    if (root["database"]) {
        auto db = root["database"];
        if (db["url"]) cfg.database.url = db["url"].as<std::string>();
        if (db["pool_size"]) cfg.database.pool_size = db["pool_size"].as<size_t>();
        if (db["connect_timeout_seconds"]) cfg.database.connect_timeout_seconds = db["connect_timeout_seconds"].as<int>();
    }

    if (root["authn"]) {
        auto a = root["authn"];
        if (a["provider"]) cfg.authn.provider = a["provider"].as<std::string>();
        if (a["delegated_header"]) cfg.authn.delegated_header = a["delegated_header"].as<std::string>();
        if (a["delegated_email_header"]) cfg.authn.delegated_email_header = a["delegated_email_header"].as<std::string>();
        if (a["session_ttl_hours"]) cfg.authn.session_ttl_hours = a["session_ttl_hours"].as<int>();
    }

    if (root["authz"]) {
        auto az = root["authz"];
        if (az["admin_provider"]) cfg.authz.admin_provider = az["admin_provider"].as<std::string>();
        if (az["admin_file_path"]) cfg.authz.admin_file_path = az["admin_file_path"].as<std::string>();
        if (az["admin_command"]) cfg.authz.admin_command = az["admin_command"].as<std::string>();
    }

    if (root["ui"]) {
        auto u = root["ui"];
        if (u["embedded"]) cfg.ui.embedded = u["embedded"].as<bool>();
        if (u["dist_dir"]) cfg.ui.dist_dir = u["dist_dir"].as<std::string>();
    }

    if (root["backup"]) {
        auto b = root["backup"];
        if (b["enabled"]) cfg.backup.enabled = b["enabled"].as<bool>();
        if (b["cron_schedule"]) cfg.backup.cron_schedule = b["cron_schedule"].as<std::string>();
        if (b["script_path"]) cfg.backup.script_path = b["script_path"].as<std::string>();
        if (b["target_dir"]) cfg.backup.target_dir = b["target_dir"].as<std::string>();
        if (b["retention_daily"]) cfg.backup.retention_daily = b["retention_daily"].as<int>();
        if (b["retention_weekly"]) cfg.backup.retention_weekly = b["retention_weekly"].as<int>();
    }

    if (root["logging"]) {
        auto l = root["logging"];
        if (l["level"]) cfg.logging.level = l["level"].as<std::string>();
        if (l["format"]) cfg.logging.format = l["format"].as<std::string>();
    }
}

} // namespace

Result<AppConfig> AppConfig::from_yaml_file(const std::string& path) {
    AppConfig cfg;
    cfg.config_file_path = path;

    if (!std::filesystem::exists(path)) {
        return std::unexpected(ErrorCode::NotFound);
    }

    try {
        YAML::Node root = YAML::LoadFile(path);
        parse_yaml_node(root, cfg);
        return cfg;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] YAML parse error: " << e.what() << "\n";
        return std::unexpected(ErrorCode::InvalidArgument);
    }
}

Result<AppConfig> AppConfig::load(int argc, char* argv[]) {
    AppConfig cfg;

    // 1. Scan CLI for an explicit --config flag first
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if ((arg == "--config" || arg == "-c") && i + 1 < argc) {
            cfg.config_file_path = argv[++i];
            break;
        }
    }

    // 2. Load YAML file if present
    if (std::filesystem::exists(cfg.config_file_path)) {
        try {
            YAML::Node root = YAML::LoadFile(cfg.config_file_path);
            parse_yaml_node(root, cfg);
        } catch (const std::exception& e) {
            std::cerr << "[WARN] Failed to load config file: " << cfg.config_file_path << " (" << e.what() << ")\n";
        }
    }

    // 3. Apply Environment Variable Overrides
    apply_env_overrides(cfg);

    // 4. Apply Command Line Arguments (Highest Precedence)
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if ((arg == "--config" || arg == "-c") && i + 1 < argc) {
            // Handled in step 1
            i++;
        } else if ((arg == "--port" || arg == "-p") && i + 1 < argc) {
            cfg.server.port = std::stoi(argv[++i]);
        } else if ((arg == "--bind" || arg == "-b") && i + 1 < argc) {
            cfg.server.bind = argv[++i];
        } else if ((arg == "--data-dir" || arg == "-d") && i + 1 < argc) {
            cfg.storage.root_path = argv[++i];
        } else if (arg == "--db-url" && i + 1 < argc) {
            cfg.database.url = argv[++i];
        } else if (arg == "--authn" && i + 1 < argc) {
            cfg.authn.provider = argv[++i];
        } else if (arg == "--authz" && i + 1 < argc) {
            cfg.authz.admin_provider = argv[++i];
        } else if (arg == "--embedded-ui" && i + 1 < argc) {
            cfg.ui.embedded = true;
            cfg.ui.dist_dir = argv[++i];
        } else if ((arg == "--threads" || arg == "-t") && i + 1 < argc) {
            cfg.server.worker_threads = std::stoi(argv[++i]);
        } else if ((arg == "--log-level" || arg == "-l") && i + 1 < argc) {
            cfg.logging.level = argv[++i];
        } else if (arg == "--verify-integrity") {
            cfg.verify_integrity_only = true;
        }
    }

    return cfg;
}

} // namespace cme::config
