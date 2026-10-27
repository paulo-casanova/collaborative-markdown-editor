#include "cme/audit/audit_service.hpp"
#include <iostream>
#include <sstream>

namespace cme::audit {

AuditService::AuditService(std::shared_ptr<db::ConnectionPool> db_pool)
    : db_pool_(std::move(db_pool)) {}

Result<int64_t> AuditService::record(const AuditEvent& event) {
    // 1. Output structured audit line to stdout for real-time log streaming
    std::cout << "[AUDIT] action=" << event.action
              << " user=" << event.username.value_or("anonymous")
              << " path='" << event.path << "'"
              << " doc_id=" << event.document_id.value_or("none")
              << " result=" << event.result << "\n";

    if (!db_pool_) {
        return 0;
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        std::cerr << "[ERROR] AuditService failed to acquire DB connection: "
                  << to_string(conn_res.error()) << "\n";
        return std::unexpected(conn_res.error());
    }

    try {
        pqxx::work tx(conn_res->get());
        auto rows = tx.exec_params(
            R"(
            INSERT INTO audit_logs (user_id, username, user_agent, action, document_id, path, result, details)
            VALUES (
                NULLIF($1, '')::uuid,
                NULLIF($2, ''),
                $3,
                $4,
                NULLIF($5, '')::uuid,
                $6,
                $7,
                $8::jsonb
            )
            RETURNING id;
            )",
            event.user_id.value_or(""),
            event.username.value_or(""),
            event.user_agent,
            event.action,
            event.document_id.value_or(""),
            event.path,
            event.result,
            event.details.dump()
        );
        tx.commit();
        if (!rows.empty()) {
            return rows[0][0].as<int64_t>();
        }
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] AuditService failed to insert audit log: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<std::vector<AuditLogEntry>> AuditService::query(const AuditQuery& q) {
    if (!db_pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto conn_res = db_pool_->acquire();
    if (!conn_res.has_value()) {
        return std::unexpected(conn_res.error());
    }

    try {
        pqxx::read_transaction tx(conn_res->get());

        std::string sql = R"(
            SELECT id,
                   TO_CHAR(timestamp, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                   COALESCE(user_id::text, ''),
                   COALESCE(username, ''),
                   COALESCE(user_agent, ''),
                   action,
                   COALESCE(document_id::text, ''),
                   COALESCE(path, ''),
                   result,
                   COALESCE(details::text, '{}')
            FROM audit_logs
            WHERE 1=1
        )";

        std::vector<std::string> params;
        int param_idx = 1;

        if (q.action.has_value() && !q.action->empty()) {
            sql += " AND action = $" + std::to_string(param_idx++);
            params.push_back(*q.action);
        }
        if (q.document_id.has_value() && !q.document_id->empty()) {
            sql += " AND document_id = $" + std::to_string(param_idx++) + "::uuid";
            params.push_back(*q.document_id);
        }
        if (q.user_id.has_value() && !q.user_id->empty()) {
            sql += " AND user_id = $" + std::to_string(param_idx++) + "::uuid";
            params.push_back(*q.user_id);
        }
        if (q.result.has_value() && !q.result->empty()) {
            sql += " AND result = $" + std::to_string(param_idx++);
            params.push_back(*q.result);
        }

        sql += " ORDER BY timestamp DESC, id DESC LIMIT " + std::to_string(q.limit > 0 ? q.limit : 100);
        sql += " OFFSET " + std::to_string(q.offset);

        pqxx::result rows;
        if (params.empty()) {
            rows = tx.exec(sql);
        } else if (params.size() == 1) {
            rows = tx.exec_params(sql, params[0]);
        } else if (params.size() == 2) {
            rows = tx.exec_params(sql, params[0], params[1]);
        } else if (params.size() == 3) {
            rows = tx.exec_params(sql, params[0], params[1], params[2]);
        } else if (params.size() == 4) {
            rows = tx.exec_params(sql, params[0], params[1], params[2], params[3]);
        }

        std::vector<AuditLogEntry> entries;
        entries.reserve(rows.size());
        for (const auto& r : rows) {
            AuditLogEntry e;
            e.id = r[0].as<int64_t>();
            e.timestamp = r[1].as<std::string>();
            std::string uid = r[2].as<std::string>();
            if (!uid.empty()) e.user_id = uid;
            std::string uname = r[3].as<std::string>();
            if (!uname.empty()) e.username = uname;
            e.user_agent = r[4].as<std::string>();
            e.action = r[5].as<std::string>();
            std::string doc_id = r[6].as<std::string>();
            if (!doc_id.empty()) e.document_id = doc_id;
            e.path = r[7].as<std::string>();
            e.result = r[8].as<std::string>();
            try {
                e.details = nlohmann::json::parse(r[9].as<std::string>());
            } catch (...) {
                e.details = nlohmann::json::object();
            }
            entries.push_back(std::move(e));
        }

        return entries;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] AuditService failed to query audit logs: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

} // namespace cme::audit
