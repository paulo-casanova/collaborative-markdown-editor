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
#include "cme/storage/storage_backend.hpp"
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
    bool number_headers{false};  ///< True if hierarchical header numbering is enabled.
    std::string created_at;      ///< ISO-8601 creation timestamp.
    std::string updated_at;      ///< ISO-8601 last update timestamp.
    std::vector<std::string> updated_referencing_docs{}; ///< Document IDs whose wikilinks were automatically updated.

    [[nodiscard]] nlohmann::json to_json(bool include_content = true) const {
        nlohmann::json j = {
            {"id", id},
            {"path", path},
            {"title", title},
            {"is_bundle", is_bundle},
            {"owner_user_id", owner_user_id},
            {"number_headers", number_headers},
            {"created_at", created_at},
            {"updated_at", updated_at},
            {"updated_referencing_docs", updated_referencing_docs}
        };
        if (include_content) {
            j["content"] = content;
        }
        return j;
    }
};

/**
 * @struct DocumentRevision
 * @brief Immutable historical snapshot of document content and authorship.
 */
struct DocumentRevision {
    std::string id;
    std::string document_id;
    int revision_number{1};
    std::string author_id;
    std::string author_name;
    std::string content;
    std::string created_at;
    size_t byte_size{0};
    bool is_latest{false};

    [[nodiscard]] nlohmann::json to_json(bool include_content = true) const {
        nlohmann::json j = {
            {"id", id},
            {"document_id", document_id},
            {"revision_number", revision_number},
            {"author_id", author_id.empty() ? nlohmann::json(nullptr) : nlohmann::json(author_id)},
            {"author_name", author_name},
            {"created_at", created_at},
            {"byte_size", byte_size > 0 ? byte_size : content.size()},
            {"is_latest", is_latest}
        };
        if (include_content) {
            j["content"] = content;
        }
        return j;
    }
};

/**
 * @struct DocumentMentionRecord
 * @brief Complete representation of an extracted document mention and its acknowledgement status.
 */
struct DocumentMentionRecord {
    std::string id;
    std::string document_id;
    std::string document_title;
    std::string document_path;
    std::string recipient_id;
    std::string author_id;
    std::string author_username;
    std::string heading_anchor;
    std::string context_snippet;
    std::string fingerprint;
    std::string status;       // "UNREAD", "ACKNOWLEDGED"
    bool is_active{true};
    std::string created_at;
    std::string acknowledged_at;

    [[nodiscard]] nlohmann::json to_json() const {
        return {
            {"id", id},
            {"document_id", document_id},
            {"document_title", document_title},
            {"document_path", document_path},
            {"recipient_id", recipient_id},
            {"author_id", author_id.empty() ? nlohmann::json(nullptr) : nlohmann::json(author_id)},
            {"author_username", author_username},
            {"heading_anchor", heading_anchor},
            {"context_snippet", context_snippet},
            {"fingerprint", fingerprint},
            {"status", status},
            {"is_active", is_active},
            {"created_at", created_at},
            {"acknowledged_at", acknowledged_at.empty() ? nlohmann::json(nullptr) : nlohmann::json(acknowledged_at)}
        };
    }
};

/**
 * @struct ListMentionsResult
 * @brief Paginated list of document mentions along with global unread count.
 */
struct ListMentionsResult {
    std::vector<DocumentMentionRecord> mentions;
    int64_t total_unread{0};

    [[nodiscard]] nlohmann::json to_json() const {
        nlohmann::json arr = nlohmann::json::array();
        for (const auto& m : mentions) {
            arr.push_back(m.to_json());
        }
        return {
            {"mentions", std::move(arr)},
            {"unread_count", total_unread}
        };
    }
};

/**
 * @struct DocumentTagOccurrence
 * @brief Represents an individual occurrence of a tag within a document.
 */
struct DocumentTagOccurrence {
    std::string heading_anchor;
    int line_number{1};

    [[nodiscard]] nlohmann::json to_json() const {
        return {
            {"heading_anchor", heading_anchor},
            {"line_number", line_number}
        };
    }
};

/**
 * @struct DocumentTagMatch
 * @brief Represents a document containing one or more occurrences of a tag.
 */
struct DocumentTagMatch {
    std::string document_id;
    std::string document_title;
    std::string document_path;
    std::string updated_at;
    int occurrence_count{0};
    std::vector<DocumentTagOccurrence> occurrences;

    [[nodiscard]] nlohmann::json to_json() const {
        nlohmann::json occ_arr = nlohmann::json::array();
        for (const auto& o : occurrences) {
            occ_arr.push_back(o.to_json());
        }
        return {
            {"id", document_id},
            {"title", document_title},
            {"path", document_path},
            {"updated_at", updated_at},
            {"occurrence_count", occurrence_count},
            {"occurrences", std::move(occ_arr)}
        };
    }
};

/**
 * @struct TagSummary
 * @brief Summary of a distinct tag across accessible documents.
 */
struct TagSummary {
    std::string tag;
    int document_count{0};
    int occurrence_count{0};

    [[nodiscard]] nlohmann::json to_json() const {
        return {
            {"tag", tag},
            {"document_count", document_count},
            {"occurrence_count", occurrence_count}
        };
    }
};

/**
 * @struct TagDocumentsResult
 * @brief Container of all accessible documents for a specific tag.
 */
struct TagDocumentsResult {
    std::string tag;
    int total_documents{0};
    std::vector<DocumentTagMatch> documents;

    [[nodiscard]] nlohmann::json to_json() const {
        nlohmann::json doc_arr = nlohmann::json::array();
        for (const auto& d : documents) {
            doc_arr.push_back(d.to_json());
        }
        return {
            {"tag", tag},
            {"total_documents", total_documents},
            {"documents", std::move(doc_arr)}
        };
    }
};

/**
 * @struct DocumentCheckout
 * @brief Representation of an exclusive checkout lock on a non-markdown/binary file.
 */
struct DocumentCheckout {
    std::string id;
    std::string document_id;
    std::string fs_path;
    std::string user_id;
    std::string username;
    std::string display_name;
    std::string checked_out_at;
    nlohmann::json metadata{nlohmann::json::object()};

    [[nodiscard]] nlohmann::json to_json(bool is_me = false) const {
        return {
            {"id", id},
            {"document_id", document_id},
            {"fs_path", fs_path},
            {"user_id", user_id},
            {"username", username},
            {"display_name", display_name},
            {"checked_out_at", checked_out_at},
            {"is_checked_out", true},
            {"is_checked_out_by_me", is_me},
            {"metadata", metadata}
        };
    }
};

/**
 * @struct BinaryRevision
 * @brief Historical revision snapshot of an external/binary document.
 */
struct BinaryRevision {
    std::string id;
    std::string document_id;
    std::string fs_path;
    int revision_number{1};
    std::string author_id;
    std::string author_name;
    std::string storage_path;
    int64_t byte_size{0};
    std::string created_at;
    std::string change_summary;
    nlohmann::json metadata{nlohmann::json::object()};

    [[nodiscard]] nlohmann::json to_json() const {
        return {
            {"id", id},
            {"document_id", document_id},
            {"fs_path", fs_path},
            {"revision_number", revision_number},
            {"author_id", author_id.empty() ? nlohmann::json(nullptr) : nlohmann::json(author_id)},
            {"author_name", author_name},
            {"storage_path", storage_path},
            {"byte_size", byte_size},
            {"created_at", created_at},
            {"change_summary", change_summary},
            {"metadata", metadata}
        };
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
    bool number_headers{false};
};

/**
 * @class DocumentService
 * @brief Coordinates document persistence between PostgreSQL metadata and POSIX Storage.
 */
class DocumentService {
public:
    DocumentService(
        std::shared_ptr<db::ConnectionPool> db_pool,
        std::shared_ptr<storage::IStorageBackend> storage
    );

    [[nodiscard]] std::shared_ptr<storage::IStorageBackend> storage() const noexcept { return storage_; }

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
     * @brief Renames or moves a directory in storage and updates database references.
     */
    Result<std::string> rename_directory(
        const std::string& old_path,
        const std::string& new_path,
        const auth::UserIdentity& user
    );

    /**
     * @brief Soft-deletes a directory and all nested documents to trash, cleaning up database records and CRDT state.
     */
    Result<std::string> delete_directory(
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
     * @brief Updates document content, title, and/or header numbering metadata.
     */
    Result<DocumentRecord> update_document(
        const std::string& doc_id,
        std::optional<std::string> content,
        std::optional<std::string> title,
        const auth::UserIdentity& user,
        std::optional<bool> number_headers = std::nullopt
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
     * @brief Converts a standalone document to a bundle, or a bundle to a standalone document.
     */
    Result<DocumentRecord> convert_document(
        const std::string& doc_id,
        const auth::UserIdentity& user
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
     * @brief Uploads an arbitrary file (image, PDF, markdown, etc.) directly into workspace storage.
     */
    Result<DocumentRecord> upload_workspace_file(
        const std::string& relative_path,
        std::string_view data,
        const auth::UserIdentity& user
    );

    /**
     * @brief Reads an arbitrary file directly from workspace storage by relative path.
     */
    Result<std::string> read_workspace_file(
        const std::string& relative_path,
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
     * @brief Search querying title, path, and content snippets (or title only).
     */
    Result<nlohmann::json> search_documents(
        const std::string& query,
        const std::string& path_prefix,
        size_t limit,
        const auth::UserIdentity& user,
        bool title_only = false
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

    /**
     * @brief Lists all asset files inside a bundle or associated with a document.
     */
    Result<nlohmann::json> list_document_assets(
        const std::string& doc_id,
        const auth::UserIdentity& user
    );

    /**
     * @brief Deletes an asset associated with a document.
     */
    Result<void> delete_document_asset(
        const std::string& doc_id,
        const std::string& filename,
        const auth::UserIdentity& user
    );

    /**
     * @brief Exports a bundle or directory as a ZIP archive binary.
     */
    Result<std::string> export_bundle_zip(
        const std::string& relative_path,
        const auth::UserIdentity& user
    );

    /**
     * @brief Exports a document bundle by its ID as a ZIP archive binary.
     */
    Result<std::string> export_document_bundle_zip(
        const std::string& doc_id,
        const auth::UserIdentity& user
    );

    /**
     * @brief Copies an existing workspace file into a bundle's assets directory.
     */
    Result<std::string> import_asset_from_workspace(
        const std::string& doc_id,
        const std::string& source_path,
        const std::string& target_filename,
        const auth::UserIdentity& user
    );

    /**
     * @brief Retrieves detailed child metrics (type, owner, comments, suggestions, tasks) for a directory dashboard.
     */
    Result<nlohmann::json> get_directory_dashboard(
        const std::string& relative_path,
        const auth::UserIdentity& user
    );

    /**
     * @brief Resolves explicit and inherited permissions, owner, and provenance for a node.
     */
    Result<nlohmann::json> get_node_permissions(
        const std::string& target_type,
        const std::string& target_id,
        const std::string& dir_path,
        const auth::UserIdentity& user
    );

    /**
     * @brief Grants or updates a permission on a document or directory.
     */
    Result<nlohmann::json> set_node_permission(
        const std::string& target_type,
        const std::string& target_id,
        const std::string& dir_path,
        const std::string& grantee_type,
        const std::string& grantee_id,
        const std::string& access_level,
        bool is_inheritable,
        const auth::UserIdentity& user
    );

    /**
     * @brief Tests what ACLs apply to a specific user or team on a node.
     */
    Result<nlohmann::json> test_node_permission(
        const std::string& target_type,
        const std::string& target_id,
        const std::string& dir_path,
        const std::string& subject_type,
        const std::string& subject_id,
        const auth::UserIdentity& user
    );

    /**
     * @brief Removes an explicit permission grant.
     */
    Result<void> delete_node_permission(
        int64_t permission_id,
        const auth::UserIdentity& user
    );

    /**
     * @brief Transfers ownership of a document or directory.
     */
    Result<void> transfer_node_ownership(
        const std::string& target_type,
        const std::string& target_id,
        const std::string& dir_path,
        const std::string& new_owner_user_id,
        const std::string& new_owner_team_id,
        const auth::UserIdentity& user
    );

    /**
     * @brief Lists available users and teams for permission assignment.
     */
    Result<nlohmann::json> get_assignable_principals(
        const auth::UserIdentity& user
    );

    /**
     * @brief Records an immutable revision entry if content has changed.
     */
    Result<DocumentRevision> record_revision(
        const std::string& doc_id,
        const std::string& content,
        const std::string& author_id,
        const std::string& author_name,
        const nlohmann::json& metadata = nlohmann::json::object()
    );

    /**
     * @brief Lists all revisions for a document, ordered descending by revision number.
     */
    Result<std::vector<DocumentRevision>> list_revisions(
        const std::string& doc_id,
        const auth::UserIdentity& user
    );

    /**
     * @brief Fetches a specific revision of a document by revision number.
     */
    Result<DocumentRevision> get_revision(
        const std::string& doc_id,
        int revision_number,
        const auth::UserIdentity& user
    );

    /**
     * @brief Automatically updates Obsidian-style wikilinks across other documents when a document is renamed or moved.
     * @return List of document IDs whose content was updated.
     */
    Result<std::vector<std::string>> update_referencing_wikilinks(
        const std::string& old_fs_path,
        const std::string& new_fs_path,
        const auth::UserIdentity& user
    );

    /**
     * @brief Automatically updates Obsidian-style wikilinks across other documents when a directory is renamed.
     * @return List of document IDs whose content was updated.
     */
    Result<std::vector<std::string>> update_referencing_wikilinks_for_dir(
        const std::string& old_dir,
        const std::string& new_dir,
        const auth::UserIdentity& user
    );

    /**
     * @brief Reconciles mentions extracted from document content with the document_mentions database table.
     * Inserts new mentions as 'UNREAD', preserves existing ACK status, and updates active state.
     */
    static Result<void> reconcile_document_mentions(
        pqxx::transaction_base& tx,
        const std::string& document_id,
        const std::string& author_id,
        std::string_view content
    );

    /**
     * @brief Lists active document mentions for a recipient with optional status filter and pagination.
     */
    Result<ListMentionsResult> list_mentions(
        const std::string& recipient_id,
        const std::string& status_filter = "UNREAD",
        size_t limit = 50,
        size_t offset = 0
    );

    /**
     * @brief Retrieves total count of active unread mentions for a recipient.
     */
    Result<int64_t> get_unread_mentions_count(
        const std::string& recipient_id
    );

    /**
     * @brief Acknowledges a specific active mention for a recipient.
     */
    Result<void> acknowledge_mention(
        const std::string& mention_id,
        const std::string& recipient_id
    );

    /**
     * @brief Acknowledges all unread mentions for a recipient.
     * @return Number of mentions marked acknowledged.
     */
    Result<int64_t> acknowledge_all_mentions(
        const std::string& recipient_id
    );

    /**
     * @brief Searches candidate users for mention autocomplete.
     */
    Result<nlohmann::json> get_mention_candidates(
        const std::string& query = ""
    );

    /**
     * @brief Reconciles tags extracted from document content with the document_tags database table.
     */
    static Result<void> reconcile_document_tags(
        pqxx::transaction_base& tx,
        const std::string& document_id,
        std::string_view content
    );

    /**
     * @brief Reconciles tasks extracted from document content with the tasks database table.
     */
    static Result<void> reconcile_document_tasks(
        pqxx::transaction_base& tx,
        const std::string& document_id,
        std::string_view content
    );

    /**
     * @brief Lists distinct tags accessible to the user, with document and occurrence counts.
     */
    Result<std::vector<TagSummary>> list_tags(
        const auth::UserIdentity& user,
        const std::string& query = ""
    );

    /**
     * @brief Retrieves all documents mentioning a given tag that are accessible to the user.
     */
    Result<TagDocumentsResult> get_tag_documents(
        const auth::UserIdentity& user,
        const std::string& tag
    );

    /**
     * @brief Checks out a document, acquiring an exclusive lock for editing.
     */
    Result<DocumentCheckout> checkout_document(
        const std::string& path,
        const auth::UserIdentity& user,
        const nlohmann::json& metadata = nlohmann::json::object()
    );

    /**
     * @brief Cancels a checkout, releasing the exclusive lock without modifications.
     */
    Result<void> cancel_checkout(
        const std::string& path,
        const auth::UserIdentity& user
    );

    /**
     * @brief Checks in a document with an updated file, creating a historical binary revision.
     */
    Result<DocumentRecord> checkin_document(
        const std::string& path,
        std::string_view new_data,
        const std::string& change_summary,
        const auth::UserIdentity& user
    );

    /**
     * @brief Lists all documents currently checked out by the specified user (or all if admin).
     */
    Result<std::vector<DocumentCheckout>> list_user_checkouts(
        const auth::UserIdentity& user
    );

    /**
     * @brief Retrieves checkout status for a specific document path.
     */
    Result<std::optional<DocumentCheckout>> get_document_checkout(
        const std::string& path
    );

    /**
     * @brief Lists historical binary revisions for a document.
     */
    Result<std::vector<BinaryRevision>> list_binary_revisions(
        const std::string& path,
        const auth::UserIdentity& user
    );

    /**
     * @brief Reads historical content of a specific binary revision.
     */
    Result<std::string> read_binary_revision_content(
        const std::string& path,
        int revision_number,
        const auth::UserIdentity& user
    );

private:
    std::shared_ptr<db::ConnectionPool> db_pool_;
    std::shared_ptr<storage::IStorageBackend> storage_;

    Result<db::AccessLevel> check_access(
        const auth::UserIdentity& user,
        const std::string& document_id,
        const std::string& fs_path
    );
};

/**
 * @brief Rewrites Obsidian-style wikilinks in markdown content targeting an old document path/stem to the new path/stem.
 * Skips code blocks and inline code spans. Preserves anchors, labels, and embeds.
 */
std::string update_markdown_wikilinks(
    std::string_view content,
    const std::string& ref_doc_path,
    const std::string& old_doc_path,
    const std::string& new_doc_path
);

/**
 * @brief Rewrites Obsidian-style wikilinks in markdown content targeting an old directory prefix to the new directory prefix.
 * Skips code blocks and inline code spans. Preserves anchors, labels, and embeds.
 */
std::string update_markdown_wikilinks_for_directory(
    std::string_view content,
    const std::string& old_dir_path,
    const std::string& new_dir_path
);

} // namespace cme::document
