/**
 * @file review_service.hpp
 * @brief Review Engine subsystem coordinating threaded comments, inline suggestions, and tasks.
 */

#pragma once

#include "cme/common.hpp"
#include "cme/auth/auth_provider.hpp"
#include "cme/db/connection_pool.hpp"
#include "cme/db/permission_engine.hpp"
#include "cme/document/document_service.hpp"
#include "cme/collab/room_manager.hpp"
#include <string>
#include <vector>
#include <optional>
#include <memory>
#include <functional>
#include <span>
#include <nlohmann/json.hpp>

namespace cme::review {

/**
 * @struct AuthorInfo
 * @brief Collaborator attribution for comments, suggestions, and tasks.
 */
struct AuthorInfo {
    std::string id;
    std::string username;
    std::string display_name;
    std::string avatar_color{"#3b82f6"};

    [[nodiscard]] nlohmann::json to_json() const {
        return {
            {"id", id},
            {"username", username},
            {"display_name", display_name},
            {"avatar_color", avatar_color}
        };
    }
};

/**
 * @struct CommentRecord
 * @brief Threaded comment entity with dual-anchoring coordinates and reply tree.
 */
struct CommentRecord {
    std::string id;
    std::string document_id;
    std::optional<std::string> parent_id;
    AuthorInfo author;
    std::string content;
    std::string status{"OPEN"}; // "OPEN" or "RESOLVED"
    nlohmann::json anchor = nlohmann::json::object();
    std::string created_at;
    std::string updated_at;
    std::vector<CommentRecord> replies;

    [[nodiscard]] nlohmann::json to_json() const {
        nlohmann::json j = {
            {"id", id},
            {"document_id", document_id},
            {"parent_id", parent_id.has_value() ? nlohmann::json(parent_id.value()) : nlohmann::json(nullptr)},
            {"author", author.to_json()},
            {"content", content},
            {"status", status},
            {"anchor", anchor},
            {"created_at", created_at},
            {"updated_at", updated_at}
        };
        if (!replies.empty()) {
            nlohmann::json arr = nlohmann::json::array();
            for (const auto& r : replies) {
                arr.push_back(r.to_json());
            }
            j["replies"] = arr;
        } else {
            j["replies"] = nlohmann::json::array();
        }
        return j;
    }
};

/**
 * @struct CreateCommentRequest
 */
struct CreateCommentRequest {
    std::string content;
    nlohmann::json anchor = nlohmann::json::object();
};

/**
 * @struct SuggestionRecord
 * @brief Inline edit proposal entity with replacement diff and resolution status.
 */
struct SuggestionRecord {
    std::string id;
    std::string document_id;
    AuthorInfo author;
    std::string status{"PENDING"}; // "PENDING", "ACCEPTED", "REJECTED"
    std::string original_text;
    std::string suggested_text;
    nlohmann::json anchor = nlohmann::json::object();
    std::string created_at;
    std::optional<std::string> resolved_at;

    [[nodiscard]] nlohmann::json to_json() const {
        return {
            {"id", id},
            {"document_id", document_id},
            {"author", author.to_json()},
            {"status", status},
            {"original_text", original_text},
            {"suggested_text", suggested_text},
            {"anchor", anchor},
            {"created_at", created_at},
            {"resolved_at", resolved_at.has_value() ? nlohmann::json(resolved_at.value()) : nlohmann::json(nullptr)}
        };
    }
};

/**
 * @struct CreateSuggestionRequest
 */
struct CreateSuggestionRequest {
    std::string original_text;
    std::string suggested_text;
    nlohmann::json anchor = nlohmann::json::object();
};

/**
 * @struct TaskRecord
 * @brief Action item task checklist entity.
 */
struct TaskRecord {
    std::string id;
    std::string document_id;
    std::string document_title{""};
    std::string document_path{""};
    std::optional<std::string> comment_id;
    std::string description;
    std::optional<AuthorInfo> assignee;
    bool is_completed{false};
    std::optional<std::string> due_date;
    std::string created_at;
    std::optional<std::string> completed_at;

    [[nodiscard]] nlohmann::json to_json() const {
        nlohmann::json j = {
            {"id", id},
            {"document_id", document_id},
            {"comment_id", comment_id.has_value() ? nlohmann::json(comment_id.value()) : nlohmann::json(nullptr)},
            {"description", description},
            {"assignee", assignee.has_value() ? assignee->to_json() : nlohmann::json(nullptr)},
            {"is_completed", is_completed},
            {"due_date", due_date.has_value() ? nlohmann::json(due_date.value()) : nlohmann::json(nullptr)},
            {"created_at", created_at},
            {"completed_at", completed_at.has_value() ? nlohmann::json(completed_at.value()) : nlohmann::json(nullptr)}
        };
        if (!document_title.empty()) j["document_title"] = document_title;
        if (!document_path.empty()) j["document_path"] = document_path;
        return j;
    }
};

/**
 * @struct CreateTaskRequest
 */
struct CreateTaskRequest {
    std::string description;
    std::optional<std::string> comment_id;
    std::optional<std::string> assignee_id;
    std::optional<std::string> due_date;
};

/**
 * @struct UpdateTaskRequest
 */
struct UpdateTaskRequest {
    std::optional<bool> is_completed;
    std::optional<std::string> description;
    std::optional<std::string> assignee_id;
    std::optional<std::string> due_date;
};

/**
 * @class ReviewService
 * @brief Manages PostgreSQL CRUD operations and live reconciliation for review discussions, suggestions, and tasks.
 */
class ReviewService {
public:
    explicit ReviewService(
        std::shared_ptr<db::ConnectionPool> db_pool,
        std::shared_ptr<document::DocumentService> doc_service = nullptr
    );

    // =========================================================================
    // Comments
    // =========================================================================
    Result<std::vector<CommentRecord>> list_comments(const std::string& document_id, const auth::UserIdentity& user);
    Result<CommentRecord> get_comment(const std::string& comment_id, const auth::UserIdentity& user);
    Result<CommentRecord> create_comment(const std::string& document_id, const auth::UserIdentity& user, const CreateCommentRequest& req);
    Result<CommentRecord> reply_comment(const std::string& comment_id, const auth::UserIdentity& user, const std::string& content);
    Result<CommentRecord> update_comment_content(const std::string& comment_id, const auth::UserIdentity& user, const std::string& content);
    Result<CommentRecord> update_comment_status(const std::string& comment_id, const auth::UserIdentity& user, const std::string& status);
    Result<CommentRecord> archive_comment(const std::string& comment_id, const auth::UserIdentity& user);
    Result<void> delete_comment(const std::string& comment_id, const auth::UserIdentity& user);

    // =========================================================================
    // Suggestions
    // =========================================================================
    Result<std::vector<SuggestionRecord>> list_suggestions(const std::string& document_id, const auth::UserIdentity& user, const std::string& status_filter = "");
    Result<SuggestionRecord> get_suggestion(const std::string& suggestion_id, const auth::UserIdentity& user);
    Result<SuggestionRecord> create_suggestion(const std::string& document_id, const auth::UserIdentity& user, const CreateSuggestionRequest& req);
    Result<SuggestionRecord> accept_suggestion(
        const std::string& suggestion_id,
        const auth::UserIdentity& user,
        std::shared_ptr<collab::RoomManager> room_manager = nullptr,
        std::function<void(const std::string& doc_id, std::span<const uint8_t> delta)> broadcast_sync_cb = nullptr
    );
    Result<SuggestionRecord> reject_suggestion(const std::string& suggestion_id, const auth::UserIdentity& user);
    Result<SuggestionRecord> archive_suggestion(const std::string& suggestion_id, const auth::UserIdentity& user);

    // =========================================================================
    // Tasks
    // =========================================================================
    Result<std::vector<TaskRecord>> list_tasks(const std::string& document_id, const auth::UserIdentity& user);
    Result<std::vector<TaskRecord>> list_all_tasks(
        const auth::UserIdentity& user,
        std::optional<bool> completed_filter = std::nullopt,
        bool assigned_to_me_only = false
    );
    Result<TaskRecord> get_task(const std::string& task_id, const auth::UserIdentity& user);
    Result<TaskRecord> create_task(const std::string& document_id, const auth::UserIdentity& user, const CreateTaskRequest& req);
    Result<TaskRecord> update_task(const std::string& task_id, const auth::UserIdentity& user, const UpdateTaskRequest& req);
    Result<TaskRecord> update_task(const std::string& task_id, const auth::UserIdentity& user, bool is_completed);
    Result<void> delete_task(const std::string& task_id, const auth::UserIdentity& user);

private:
    Result<db::AccessLevel> check_doc_access(const std::string& document_id, const auth::UserIdentity& user, std::string* out_fs_path = nullptr);

    std::shared_ptr<db::ConnectionPool> db_pool_;
    std::shared_ptr<document::DocumentService> doc_service_;
};

} // namespace cme::review
