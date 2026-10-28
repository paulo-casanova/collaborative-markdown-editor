/**
 * @file dialog_service.hpp
 * @brief Subsystem managing LLM dialog threads, messages, document associations, and agent tokens.
 */

#pragma once

#include "cme/common.hpp"
#include "cme/auth/auth_provider.hpp"
#include "cme/db/connection_pool.hpp"
#include <string>
#include <vector>
#include <optional>
#include <memory>
#include <nlohmann/json.hpp>

namespace cme::dialog {

/**
 * @struct DialogRecord
 * @brief Represents a persistent conversation dialog thread owned by a user.
 */
struct DialogRecord {
    std::string id;
    std::string user_id;
    std::string title;
    std::string created_at;
    std::string updated_at;
    size_t message_count{0};

    [[nodiscard]] nlohmann::json to_json() const {
        return {
            {"id", id},
            {"user_id", user_id},
            {"title", title},
            {"created_at", created_at},
            {"updated_at", updated_at},
            {"message_count", message_count}
        };
    }
};

/**
 * @struct DialogMessageRecord
 * @brief Represents a chronological message inside a dialog thread with context snapshot.
 */
struct DialogMessageRecord {
    std::string id;
    std::string dialog_id;
    std::string role; // "user", "assistant", "system", "tool"
    std::string content;
    nlohmann::json context_snapshot = nlohmann::json::object();
    std::string created_at;

    [[nodiscard]] nlohmann::json to_json() const {
        return {
            {"id", id},
            {"dialog_id", dialog_id},
            {"role", role},
            {"content", content},
            {"context_snapshot", context_snapshot},
            {"created_at", created_at}
        };
    }
};

/**
 * @struct AgentTokenRecord
 * @brief Represents metadata for a registered local agent pairing token.
 */
struct AgentTokenRecord {
    std::string id;
    std::string user_id;
    std::string name;
    std::optional<std::string> last_used_at;
    std::string created_at;

    [[nodiscard]] nlohmann::json to_json() const {
        return {
            {"id", id},
            {"user_id", user_id},
            {"name", name},
            {"last_used_at", last_used_at.has_value() ? nlohmann::json(*last_used_at) : nlohmann::json(nullptr)},
            {"created_at", created_at}
        };
    }
};

/**
 * @struct CreatedAgentTokenResult
 * @brief Returned upon token creation containing the plaintext token once.
 */
struct CreatedAgentTokenResult {
    std::string id;
    std::string name;
    std::string token;
    std::string created_at;

    [[nodiscard]] nlohmann::json to_json() const {
        return {
            {"id", id},
            {"name", name},
            {"token", token},
            {"created_at", created_at}
        };
    }
};

/**
 * @class DialogService
 * @brief Coordinates relational persistence and validation for dialogs, messages, and agent pairing.
 */
class DialogService {
public:
    explicit DialogService(std::shared_ptr<db::ConnectionPool> db_pool);

    // --- Dialog Operations ---

    /**
     * @brief Creates a new conversational dialog thread for a user.
     */
    Result<DialogRecord> create_dialog(const std::string& user_id, const std::string& title);

    /**
     * @brief Lists all dialog threads owned by a user, ordered by updated_at descending.
     */
    Result<std::vector<DialogRecord>> list_dialogs(const std::string& user_id);

    /**
     * @brief Retrieves a dialog thread by ID, verifying user ownership.
     */
    Result<DialogRecord> get_dialog(const std::string& user_id, const std::string& dialog_id);

    /**
     * @brief Updates the title of an existing dialog thread.
     */
    Result<DialogRecord> update_dialog(const std::string& user_id, const std::string& dialog_id, const std::string& title);

    /**
     * @brief Deletes a dialog thread and cascades deletion of its messages.
     */
    Result<void> delete_dialog(const std::string& user_id, const std::string& dialog_id);

    // --- Document Association Preferences ---

    /**
     * @brief Retrieves the dialog ID last selected by the user for a document.
     * @return Dialog ID if set, or std::nullopt.
     */
    Result<std::optional<std::string>> get_document_dialog(const std::string& user_id, const std::string& document_id);

    /**
     * @brief Sets or updates the dialog preference for a document for this user.
     */
    Result<void> set_document_dialog(const std::string& user_id, const std::string& document_id, const std::string& dialog_id);

    // --- Message History Operations ---

    /**
     * @brief Lists chronological messages for a dialog thread.
     */
    Result<std::vector<DialogMessageRecord>> list_messages(const std::string& user_id, const std::string& dialog_id, size_t limit = 200);

    /**
     * @brief Adds a message to a dialog thread, verifying dialog ownership and updating dialog updated_at.
     */
    Result<DialogMessageRecord> add_message(
        const std::string& user_id,
        const std::string& dialog_id,
        const std::string& role,
        const std::string& content,
        const nlohmann::json& context_snapshot = nlohmann::json::object()
    );

    /**
     * @brief Truncates dialog messages after a given message ID (resetting conversation to that point).
     */
    Result<std::vector<DialogMessageRecord>> truncate_dialog(
        const std::string& user_id,
        const std::string& dialog_id,
        const std::string& target_message_id,
        bool inclusive = false
    );

    /**
     * @brief Forks a dialog thread (and messages up to target_message_id) into a new dialog thread.
     */
    Result<DialogRecord> fork_dialog(
        const std::string& user_id,
        const std::string& source_dialog_id,
        const std::optional<std::string>& up_to_message_id = std::nullopt,
        const std::string& custom_title = ""
    );

    // --- Agent Token Operations ---

    /**
     * @brief Generates a new cryptographic pairing token for a user's local agent.
     * Stores only the SHA-256 hash in PostgreSQL and returns the plaintext token once.
     */
    Result<CreatedAgentTokenResult> create_agent_token(const std::string& user_id, const std::string& name);

    /**
     * @brief Lists active agent tokens for a user.
     */
    Result<std::vector<AgentTokenRecord>> list_agent_tokens(const std::string& user_id);

    /**
     * @brief Revokes an agent pairing token.
     */
    Result<void> revoke_agent_token(const std::string& user_id, const std::string& token_id);

    /**
     * @brief Validates a plaintext agent token against stored SHA-256 hashes.
     * If valid, updates last_used_at to NOW() and returns the user_id.
     */
    Result<std::optional<std::string>> validate_agent_token(const std::string& plaintext_token);

private:
    std::shared_ptr<db::ConnectionPool> db_pool_;
};

} // namespace cme::dialog
