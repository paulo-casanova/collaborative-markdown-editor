/**
 * @file document_service.hpp
 * @brief High-level document CRUD, workspace tree traversal, and asset management service.
 */

#pragma once

#include <string>
#include <string_view>
#include <optional>
#include <vector>
#include <memory>
#include <nlohmann/json.hpp>
#include "cme/common.hpp"
#include "cme/auth/user_identity.hpp"
#include "cme/db/connection_pool.hpp"
#include "cme/db/permission_engine.hpp"
#include "cme/storage/posix_storage_backend.hpp"
#include "cme/renderer/markdown_renderer.hpp"

namespace cme::document {

/**
 * @struct DocumentRecord
 * @brief Complete document metadata and content representation.
 */
struct DocumentRecord {
    std::string id;              ///< Database UUID identifier.
    std::string path;            ///< Relative storage path (e.g. "guides/intro.md").
    std::string title;           ///< Document title.
    std::string content;         ///< Raw markdown content.
    bool is_bundle{false};       ///< True if document is stored as a directory bundle.
    std::string owner_user_id;   ///< UUID of document owner.
    std::string created_at;      ///< ISO-8601 creation timestamp.
    std::string updated_at;      ///< ISO-8601 last update timestamp.

    [[nodiscard]] nlohmann::json to_json(bool include_content = true) const {
        nlohmann::json j = {
            {"id", id},
            {"path", path},
            {"title", title},
            {"is_bundle", is_bundle},
            {"owner_user_id", owner_user_id},
            {"created_at", created_at},
            {"updated_at", updated_at}
        };
        if (include_content) {
            j["content"] = content;
        }
        return j;
    }
};

/**
 * @struct CreateDocumentRequest
 * @brief Request parameters for document instantiation.
 */
struct CreateDocumentRequest {
    std::string path;
    std::string content;
    std::string title;
    bool is_bundle{false};
};

/**
 * @class DocumentService
 * @brief Coordinates document persistence between PostgreSQL metadata and POSIX Storage.
 */
class DocumentService {
public:
    DocumentService(
        std::shared_ptr<db::ConnectionPool> db_pool,
        std::shared_ptr<storage::PosixStorageBackend> storage
    );

    [[nodiscard]] std::shared_ptr<storage::PosixStorageBackend> storage() const noexcept { return storage_; }

    /**
     * @brief Creates a new document or document bundle.
     */
    Result<DocumentRecord> create_document(
        const CreateDocumentRequest& req,
        const auth::UserIdentity& user
    );

    /**
     * @brief Creates a new empty directory in workspace storage.
     */
    Result<std::string> create_directory(
        const std::string& relative_path,
        const auth::UserIdentity& user
    );

    /**
     * @brief Fetches a document by its database UUID.
     */
    Result<DocumentRecord> get_document_by_id(
        const std::string& doc_id,
        const auth::UserIdentity& user
    );

    /**
     * @brief Lookups a document by its relative filesystem path.
     */
    Result<DocumentRecord> get_document_by_path(
        const std::string& relative_path,
        const auth::UserIdentity& user
    );

    /**
     * @brief Fetches raw markdown UTF-8 string for a document.
     */
    Result<std::string> get_document_raw(
        const std::string& doc_id,
        const auth::UserIdentity& user
    );

    /**
     * @brief Updates document content and optionally its title.
     */
    Result<DocumentRecord> update_document(
        const std::string& doc_id,
        const std::string& content,
        std::optional<std::string> title,
        const auth::UserIdentity& user
    );

    /**
     * @brief Moves or renames a document in storage and updates PostgreSQL metadata.
     */
    Result<DocumentRecord> move_document(
        const std::string& doc_id,
        const std::string& new_path,
        const auth::UserIdentity& user,
        std::optional<std::string> new_title = std::nullopt
    );

    /**
     * @brief Soft-deletes a document to trash and removes database index.
     */
    Result<std::string> delete_document(
        const std::string& doc_id,
        const auth::UserIdentity& user
    );

    /**
     * @brief Uploads an image or attachment associated with a document.
     */
    Result<std::string> upload_asset(
        const std::string& doc_id,
        const std::string& filename,
        std::string_view data,
        const auth::UserIdentity& user
    );

    /**
     * @brief Reads an image or attachment associated with a document.
     */
    Result<std::string> read_asset(
        const std::string& doc_id,
        const std::string& filename,
        const auth::UserIdentity& user
    );

    /**
     * @brief Generates the hierarchical workspace tree filtered by user READ permissions.
     */
    Result<nlohmann::json> get_workspace_tree(const auth::UserIdentity& user);

    /**
     * @brief Retrieves active reviews, comments, suggestions, and tasks for a document.
     */
    Result<renderer::ReviewBundle> get_document_reviews(
        const std::string& doc_id,
        const auth::UserIdentity& user
    );

    /**
     * @brief Fetches recently accessed or modified documents accessible to user.
     */
    Result<nlohmann::json> get_recent_documents(
        const auth::UserIdentity& user,
        size_t limit = 20
    );

    /**
     * @brief Full-text search querying title, path, and content snippets.
     */
    Result<nlohmann::json> search_documents(
        const std::string& query,
        const std::string& path_prefix,
        size_t limit,
        const auth::UserIdentity& user
    );

    /**
     * @brief Lists soft-deleted items stored in POSIX trash.
     */
    Result<nlohmann::json> list_trash(const auth::UserIdentity& user);

    /**
     * @brief Restores a soft-deleted item from trash back to active workspace.
     */
    Result<DocumentRecord> restore_trash_item(
        const std::string& trash_id,
        const std::string& target_path,
        const auth::UserIdentity& user
    );

    /**
     * @brief Permanently purges a soft-deleted item from trash disk.
     */
    Result<void> purge_trash_item(
        const std::string& trash_id,
        const auth::UserIdentity& user
    );

private:
    std::shared_ptr<db::ConnectionPool> db_pool_;
    std::shared_ptr<storage::PosixStorageBackend> storage_;

    Result<db::AccessLevel> check_access(
        const auth::UserIdentity& user,
        const std::string& document_id,
        const std::string& fs_path
    );
};

} // namespace cme::document
