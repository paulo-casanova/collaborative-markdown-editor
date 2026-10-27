/**
 * @file audit_service.hpp
 * @brief Persistent database audit logging service for tracking workspace, document, and access changes.
 */

#pragma once

#include "cme/common.hpp"
#include "cme/db/connection_pool.hpp"
#include <nlohmann/json.hpp>
#include <string>
#include <vector>
#include <optional>
#include <memory>

namespace cme::audit {

/**
 * @struct AuditEvent
 * @brief Parameters for recording an audit entry.
 */
struct AuditEvent {
    std::optional<std::string> user_id;
    std::optional<std::string> username;
    std::string user_agent;
    std::string action;
    std::optional<std::string> document_id;
    std::string path;
    std::string result; // e.g. "SUCCESS", "DENIED", "ERROR", "NOT_FOUND"
    nlohmann::json details = nlohmann::json::object();
};

/**
 * @struct AuditLogEntry
 * @brief Persisted audit log row.
 */
struct AuditLogEntry {
    int64_t id{0};
    std::string timestamp;
    std::optional<std::string> user_id;
    std::optional<std::string> username;
    std::string user_agent;
    std::string action;
    std::optional<std::string> document_id;
    std::string path;
    std::string result;
    nlohmann::json details;

    [[nodiscard]] nlohmann::json to_json() const {
        return {
            {"id", id},
            {"timestamp", timestamp},
            {"user_id", user_id.has_value() ? nlohmann::json(*user_id) : nlohmann::json(nullptr)},
            {"username", username.has_value() ? nlohmann::json(*username) : nlohmann::json(nullptr)},
            {"user_agent", user_agent},
            {"action", action},
            {"document_id", document_id.has_value() ? nlohmann::json(*document_id) : nlohmann::json(nullptr)},
            {"path", path},
            {"result", result},
            {"details", details}
        };
    }
};

/**
 * @struct AuditQuery
 * @brief Query filter parameters for retrieving audit records.
 */
struct AuditQuery {
    size_t limit{100};
    size_t offset{0};
    std::optional<std::string> action;
    std::optional<std::string> document_id;
    std::optional<std::string> user_id;
    std::optional<std::string> result;
};

/**
 * @class AuditService
 * @brief Service responsible for writing and querying change audit logs in PostgreSQL.
 */
class AuditService {
public:
    explicit AuditService(std::shared_ptr<db::ConnectionPool> db_pool);

    /**
     * @brief Records an audit event to the database and standard output.
     */
    Result<int64_t> record(const AuditEvent& event);

    /**
     * @brief Queries audit log entries with optional filters.
     */
    Result<std::vector<AuditLogEntry>> query(const AuditQuery& q = {});

private:
    std::shared_ptr<db::ConnectionPool> db_pool_;
};

} // namespace cme::audit
