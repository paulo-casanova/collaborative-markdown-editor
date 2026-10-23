#include "cme/config/config.hpp"
#include <yaml-cpp/yaml.h>
#include <filesystem>
#include <iostream>
#include <cstdlib>
#include <sstream>

namespace cme::config {

namespace {

void apply_env_overrides(AppConfig& cfg) {
    if (const char* v = std::getenv("CME_SERVER_BIND")) cfg.server.bind = v;
    if (const char* v = std::getenv("CME_SERVER_PORT")) cfg.server.port = std::stoi(v);
    if (const char* v = std::getenv("CME_SERVER_KEEPALIVE_TIMEOUT_SECONDS")) cfg.server.keepalive_timeout_seconds = std::stoi(v);
    if (const char* v = std::getenv("CME_SERVER_CORS_ALLOWED_ORIGINS")) {
        cfg.server.cors_allowed_origins.clear();
        std::string list_str(v);
        std::stringstream ss(list_str);
        std::string item;
        while (std::getline(ss, item, ',')) {
            while (!item.empty() && std::isspace(static_cast<unsigned char>(item.front()))) item.erase(item.begin());
            while (!item.empty() && std::isspace(static_cast<unsigned char>(item.back()))) item.pop_back();
            if (!item.empty()) cfg.server.cors_allowed_origins.push_back(item);
        }
    }
    if (const char* v = std::getenv("CME_STORAGE_BACKEND")) cfg.storage.backend = v;
    if (const char* v = std::getenv("CME_STORAGE_ROOT_PATH")) cfg.storage.root_path = v;
    if (const char* v = std::getenv("CME_STORAGE_S3_BUCKET")) cfg.storage.s3_bucket = v;
    if (const char* v = std::getenv("CME_STORAGE_S3_REGION")) cfg.storage.s3_region = v;
    if (const char* v = std::getenv("CME_STORAGE_S3_ENDPOINT")) cfg.storage.s3_endpoint = v;
    if (const char* v = std::getenv("CME_STORAGE_S3_PREFIX")) cfg.storage.s3_prefix = v;
    if (const char* v = std::getenv("CME_STORAGE_S3_ACCESS_KEY")) cfg.storage.s3_access_key = v;
    if (const char* v = std::getenv("CME_STORAGE_S3_SECRET_KEY")) cfg.storage.s3_secret_key = v;
    if (const char* v = std::getenv("CME_DATABASE_URL")) cfg.database.url = v;
    if (const char* v = std::getenv("CME_DATABASE_LEASE_ENABLED")) cfg.database.lease_enabled = (std::string(v) == "true" || std::string(v) == "1");
    if (const char* v = std::getenv("CME_DATABASE_LEASE_NAME")) cfg.database.lease_name = v;
    if (const char* v = std::getenv("CME_DATABASE_LEASE_TTL_SECONDS")) cfg.database.lease_ttl_seconds = std::stoi(v);
    if (const char* v = std::getenv("CME_DATABASE_LEASE_RENEW_INTERVAL_SECONDS")) cfg.database.lease_renew_interval_seconds = std::stoi(v);
    if (const char* v = std::getenv("CME_DATABASE_LEASE_WAIT")) cfg.database.lease_wait = (std::string(v) == "true" || std::string(v) == "1");
    if (const char* v = std::getenv("CME_DATABASE_LEASE_RETRY_INTERVAL_SECONDS")) cfg.database.lease_retry_interval_seconds = std::stoi(v);
    if (const char* v = std::getenv("CME_DATABASE_LEASE_ACQUIRE_TIMEOUT_SECONDS")) cfg.database.lease_acquire_timeout_seconds = std::stoi(v);
    if (const char* v = std::getenv("CME_AUTHN_PROVIDER")) cfg.authn.provider = v;
    if (const char* v = std::getenv("CME_AUTHN_DELEGATED_HEADER")) cfg.authn.delegated_header = v;
    if (const char* v = std::getenv("CME_AUTHN_PROXY_SECRET_HEADER")) cfg.authn.proxy_secret_header = v;
    if (const char* v = std::getenv("CME_AUTHN_PROXY_SECRET_VALUE")) cfg.authn.proxy_secret_value = v;
    if (const char* v = std::getenv("CME_AUTHN_REQUIRED_HEADERS")) {
        std::string list_str(v);
        std::stringstream ss(list_str);
        std::string item;
        while (std::getline(ss, item, ',')) {
            auto eq = item.find('=');
            if (eq != std::string::npos) {
                cfg.authn.required_headers[item.substr(0, eq)] = item.substr(eq + 1);
            }
        }
    }
    if (const char* v = std::getenv("CME_AUTHZ_ADMIN_PROVIDER")) cfg.authz.admin_provider = v;
    if (const char* v = std::getenv("CME_AUTHZ_ADMIN_COMMAND")) cfg.authz.admin_command = v;
    if (const char* v = std::getenv("CME_LOGGING_LEVEL")) cfg.logging.level = v;
    if (const char* v = std::getenv("CME_UI_EMBEDDED")) cfg.ui.embedded = (std::string(v) == "true" || std::string(v) == "1");
    if (const char* v = std::getenv("CME_UI_DIST_DIR")) cfg.ui.dist_dir = v;
    if (const char* v = std::getenv("CME_SNIPPETS_ALLOWED_HOSTS")) {
        cfg.snippets.allowed_hosts.clear();
        std::string list_str(v);
        std::stringstream ss(list_str);
        std::string item;
        while (std::getline(ss, item, ',')) {
            while (!item.empty() && std::isspace(static_cast<unsigned char>(item.front()))) item.erase(item.begin());
            while (!item.empty() && std::isspace(static_cast<unsigned char>(item.back()))) item.pop_back();
            if (!item.empty()) cfg.snippets.allowed_hosts.push_back(item);
        }
    }
    if (const char* v = std::getenv("CME_SNIPPETS_DEFAULT_CURL_ARGS")) {
        cfg.snippets.default_curl_args = v;
    }
    if (const char* v = std::getenv("CME_SNIPPET_ENDPOINTS")) {
        std::string list_str(v);
        std::stringstream ss(list_str);
        std::string item;
        while (std::getline(ss, item, ',')) {
            auto eq = item.find('=');
            if (eq != std::string::npos) {
                std::string name = item.substr(0, eq);
                std::string rest = item.substr(eq + 1);
                while (!name.empty() && std::isspace(static_cast<unsigned char>(name.front()))) name.erase(name.begin());
                while (!name.empty() && std::isspace(static_cast<unsigned char>(name.back()))) name.pop_back();
                SnippetEndpointConfig ep;
                auto pipe_pos = rest.find('|');
                if (pipe_pos != std::string::npos) {
                    ep.url = rest.substr(0, pipe_pos);
                    ep.curl_args = rest.substr(pipe_pos + 1);
                } else {
                    ep.url = rest;
                }
                cfg.snippets.endpoints[name] = ep;
            }
        }
    }
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
        if (s["keepalive_timeout_seconds"]) cfg.server.keepalive_timeout_seconds = s["keepalive_timeout_seconds"].as<int>();
        if (s["cors_allowed_origins"]) {
            cfg.server.cors_allowed_origins.clear();
            if (s["cors_allowed_origins"].IsSequence()) {
                for (const auto& item : s["cors_allowed_origins"]) {
                    cfg.server.cors_allowed_origins.push_back(item.as<std::string>());
                }
            } else if (s["cors_allowed_origins"].IsScalar()) {
                std::string val = s["cors_allowed_origins"].as<std::string>();
                std::stringstream ss(val);
                std::string item;
                while (std::getline(ss, item, ',')) {
                    while (!item.empty() && std::isspace(static_cast<unsigned char>(item.front()))) item.erase(item.begin());
                    while (!item.empty() && std::isspace(static_cast<unsigned char>(item.back()))) item.pop_back();
                    if (!item.empty()) cfg.server.cors_allowed_origins.push_back(item);
                }
            }
        }
    }

    if (root["storage"]) {
        auto st = root["storage"];
        if (st["backend"]) cfg.storage.backend = st["backend"].as<std::string>();
        if (st["root_path"]) cfg.storage.root_path = st["root_path"].as<std::string>();
        if (st["trash_retention_days"]) cfg.storage.trash_retention_days = st["trash_retention_days"].as<int>();
        if (st["snapshot_interval_seconds"]) cfg.storage.snapshot_interval_seconds = st["snapshot_interval_seconds"].as<int>();
        if (st["s3_bucket"]) cfg.storage.s3_bucket = st["s3_bucket"].as<std::string>();
        if (st["s3_region"]) cfg.storage.s3_region = st["s3_region"].as<std::string>();
        if (st["s3_endpoint"]) cfg.storage.s3_endpoint = st["s3_endpoint"].as<std::string>();
        if (st["s3_prefix"]) cfg.storage.s3_prefix = st["s3_prefix"].as<std::string>();
        if (st["s3_access_key"]) cfg.storage.s3_access_key = st["s3_access_key"].as<std::string>();
        if (st["s3_secret_key"]) cfg.storage.s3_secret_key = st["s3_secret_key"].as<std::string>();
        if (st["s3_force_path_style"]) cfg.storage.s3_force_path_style = st["s3_force_path_style"].as<bool>();
    }

    if (root["database"]) {
        auto db = root["database"];
        if (db["url"]) cfg.database.url = db["url"].as<std::string>();
        if (db["pool_size"]) cfg.database.pool_size = db["pool_size"].as<size_t>();
        if (db["connect_timeout_seconds"]) cfg.database.connect_timeout_seconds = db["connect_timeout_seconds"].as<int>();
        if (db["lease_enabled"]) cfg.database.lease_enabled = db["lease_enabled"].as<bool>();
        if (db["lease_name"]) cfg.database.lease_name = db["lease_name"].as<std::string>();
        if (db["lease_ttl_seconds"]) cfg.database.lease_ttl_seconds = db["lease_ttl_seconds"].as<int>();
        if (db["lease_renew_interval_seconds"]) cfg.database.lease_renew_interval_seconds = db["lease_renew_interval_seconds"].as<int>();
        if (db["lease_wait"]) cfg.database.lease_wait = db["lease_wait"].as<bool>();
        if (db["lease_retry_interval_seconds"]) cfg.database.lease_retry_interval_seconds = db["lease_retry_interval_seconds"].as<int>();
        if (db["lease_acquire_timeout_seconds"]) cfg.database.lease_acquire_timeout_seconds = db["lease_acquire_timeout_seconds"].as<int>();
    }

    if (root["authn"]) {
        auto a = root["authn"];
        if (a["provider"]) cfg.authn.provider = a["provider"].as<std::string>();
        if (a["delegated_header"]) cfg.authn.delegated_header = a["delegated_header"].as<std::string>();
        if (a["delegated_email_header"]) cfg.authn.delegated_email_header = a["delegated_email_header"].as<std::string>();
        if (a["session_ttl_hours"]) cfg.authn.session_ttl_hours = a["session_ttl_hours"].as<int>();
        if (a["proxy_secret_header"]) cfg.authn.proxy_secret_header = a["proxy_secret_header"].as<std::string>();
        if (a["proxy_secret_value"]) cfg.authn.proxy_secret_value = a["proxy_secret_value"].as<std::string>();
        if (a["required_headers"] && a["required_headers"].IsMap()) {
            for (auto it = a["required_headers"].begin(); it != a["required_headers"].end(); ++it) {
                cfg.authn.required_headers[it->first.as<std::string>()] = it->second.as<std::string>();
            }
        }
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

    if (root["snippets"]) {
        auto sn = root["snippets"];
        if (sn["allowed_hosts"]) {
            cfg.snippets.allowed_hosts.clear();
            if (sn["allowed_hosts"].IsSequence()) {
                for (const auto& item : sn["allowed_hosts"]) {
                    cfg.snippets.allowed_hosts.push_back(item.as<std::string>());
                }
            } else if (sn["allowed_hosts"].IsScalar()) {
                std::string list_str = sn["allowed_hosts"].as<std::string>();
                std::stringstream ss(list_str);
                std::string item;
                while (std::getline(ss, item, ',')) {
                    while (!item.empty() && std::isspace(static_cast<unsigned char>(item.front()))) item.erase(item.begin());
                    while (!item.empty() && std::isspace(static_cast<unsigned char>(item.back()))) item.pop_back();
                    if (!item.empty()) cfg.snippets.allowed_hosts.push_back(item);
                }
            }
        }
        if (sn["default_curl_args"]) {
            cfg.snippets.default_curl_args = sn["default_curl_args"].as<std::string>();
        }
        if (sn["endpoints"] && sn["endpoints"].IsMap()) {
            for (auto it = sn["endpoints"].begin(); it != sn["endpoints"].end(); ++it) {
                std::string ep_name = it->first.as<std::string>();
                SnippetEndpointConfig ep;
                if (it->second.IsScalar()) {
                    ep.url = it->second.as<std::string>();
                } else if (it->second.IsMap()) {
                    if (it->second["url"]) ep.url = it->second["url"].as<std::string>();
                    if (it->second["curl_args"]) ep.curl_args = it->second["curl_args"].as<std::string>();
                }
                cfg.snippets.endpoints[ep_name] = ep;
            }
        }
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
        } else if (arg == "--storage-backend" && i + 1 < argc) {
            cfg.storage.backend = argv[++i];
        } else if (arg == "--s3-bucket" && i + 1 < argc) {
            cfg.storage.s3_bucket = argv[++i];
        } else if (arg == "--s3-endpoint" && i + 1 < argc) {
            cfg.storage.s3_endpoint = argv[++i];
        } else if (arg == "--db-url" && i + 1 < argc) {
            cfg.database.url = argv[++i];
        } else if (arg == "--authn" && i + 1 < argc) {
            cfg.authn.provider = argv[++i];
        } else if (arg == "--proxy-secret-header" && i + 1 < argc) {
            cfg.authn.proxy_secret_header = argv[++i];
        } else if (arg == "--proxy-secret-value" && i + 1 < argc) {
            cfg.authn.proxy_secret_value = argv[++i];
        } else if (arg == "--required-header" && i + 1 < argc) {
            std::string h = argv[++i];
            auto eq = h.find('=');
            if (eq != std::string::npos) {
                cfg.authn.required_headers[h.substr(0, eq)] = h.substr(eq + 1);
            }
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
        } else if (arg == "--keepalive-timeout" && i + 1 < argc) {
            cfg.server.keepalive_timeout_seconds = std::stoi(argv[++i]);
        } else if (arg == "--cors-allowed-origins" && i + 1 < argc) {
            cfg.server.cors_allowed_origins.clear();
            std::string list_str(argv[++i]);
            std::stringstream ss(list_str);
            std::string item;
            while (std::getline(ss, item, ',')) {
                while (!item.empty() && std::isspace(static_cast<unsigned char>(item.front()))) item.erase(item.begin());
                while (!item.empty() && std::isspace(static_cast<unsigned char>(item.back()))) item.pop_back();
                if (!item.empty()) cfg.server.cors_allowed_origins.push_back(item);
            }
        } else if (arg == "--snippet-allowed-hosts" && i + 1 < argc) {
            cfg.snippets.allowed_hosts.clear();
            std::string list_str(argv[++i]);
            std::stringstream ss(list_str);
            std::string item;
            while (std::getline(ss, item, ',')) {
                while (!item.empty() && std::isspace(static_cast<unsigned char>(item.front()))) item.erase(item.begin());
                while (!item.empty() && std::isspace(static_cast<unsigned char>(item.back()))) item.pop_back();
                if (!item.empty()) cfg.snippets.allowed_hosts.push_back(item);
            }
        } else if (arg == "--snippet-endpoint" && i + 1 < argc) {
            std::string item(argv[++i]);
            auto eq = item.find('=');
            if (eq != std::string::npos) {
                std::string name = item.substr(0, eq);
                std::string rest = item.substr(eq + 1);
                while (!name.empty() && std::isspace(static_cast<unsigned char>(name.front()))) name.erase(name.begin());
                while (!name.empty() && std::isspace(static_cast<unsigned char>(name.back()))) name.pop_back();
                SnippetEndpointConfig ep;
                auto pipe_pos = rest.find('|');
                if (pipe_pos != std::string::npos) {
                    ep.url = rest.substr(0, pipe_pos);
                    ep.curl_args = rest.substr(pipe_pos + 1);
                } else {
                    ep.url = rest;
                }
                cfg.snippets.endpoints[name] = ep;
            }
        }
    }

    return cfg;
}

} // namespace cme::config
