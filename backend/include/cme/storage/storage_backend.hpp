/**
 * @file storage_backend.hpp
 * @brief Abstract interface for the CME Storage Abstraction Layer (SAL).
 */

#pragma once

#include <string>
#include <string_view>
#include <vector>
#include <chrono>
#include "cme/common.hpp"

namespace cme::storage {

/**
 * @struct NodeInfo
 * @brief Metadata describing a file, directory, or document bundle in the storage tree.
 */
struct NodeInfo {
    std::string relative_path;                                 ///< Path relative to storage root (e.g. "engineering/spec.md").
    std::string name;                                          ///< Filename or directory name (e.g. "spec.md").
    bool is_directory{false};                                  ///< True if this node is a directory.
    bool is_bundle{false};                                     ///< True if this node is recognized as a document bundle.
    uint64_t size_bytes{0};                                    ///< File size in bytes (0 for directories).
    std::chrono::system_clock::time_point last_modified{};      ///< Last modification timestamp.
};

/**
 * @class IStorageBackend
 * @brief Pure virtual interface defining filesystem storage operations.
 * 
 * Abstracting storage operations allows pluggable support for POSIX filesystems,
 * object storage (S3/GCS), or custom cloud backends.
 */
class IStorageBackend {
public:
    virtual ~IStorageBackend() = default;

    /**
     * @brief Writes content to a file at the specified relative path.
     * @param relative_path Target file path relative to active content root.
     * @param content UTF-8 text or binary content to write.
     * @param atomic If true, writes to temporary file and renames into place atomically.
     * @return Result<void> Success or ErrorCode (IoError, InvalidArgument).
     */
    virtual Result<void> write_file(
        const std::string& relative_path,
        std::string_view content,
        bool atomic = true
    ) = 0;

    /**
     * @brief Reads entire content of a file into a string.
     * @param relative_path File path relative to active content root.
     * @return Result<std::string> File content or ErrorCode (NotFound, IoError).
     */
    virtual Result<std::string> read_file(const std::string& relative_path) = 0;

    /**
     * @brief Creates a directory (including parent directories if missing).
     * @param relative_path Directory path relative to active content root.
     * @return Result<void> Success or ErrorCode.
     */
    virtual Result<void> create_directory(const std::string& relative_path) = 0;

    /**
     * @brief Checks if a file or directory exists.
     * @param relative_path Path to check.
     * @return Result<bool> True if node exists, false otherwise.
     */
    virtual Result<bool> exists(const std::string& relative_path) = 0;

    /**
     * @brief Retrieves metadata for a file or directory.
     * @param relative_path Path to evaluate.
     * @return Result<NodeInfo> Node metadata or NotFound.
     */
    virtual Result<NodeInfo> get_node_info(const std::string& relative_path) = 0;

    /**
     * @brief Lists children within a directory.
     * @param relative_path Directory path relative to content root.
     * @param recursive If true, recursively traverses subdirectories.
     * @return Result<std::vector<NodeInfo>> List of child node metadata.
     */
    virtual Result<std::vector<NodeInfo>> list_directory(
        const std::string& relative_path,
        bool recursive = false
    ) = 0;

    /**
     * @brief Moves or renames a file or directory.
     * @param source_path Current relative path.
     * @param destination_path Target relative path.
     * @return Result<void> Success or ErrorCode (NotFound, AlreadyExists, IoError).
     */
    virtual Result<void> move_node(
        const std::string& source_path,
        const std::string& destination_path
    ) = 0;

    /**
     * @brief Soft-deletes a file or directory by moving it to the trash folder.
     * @param relative_path Path of the node to move to trash.
     * @return Result<std::string> Generated trash entry identifier (timestamped path).
     */
    virtual Result<std::string> delete_to_trash(const std::string& relative_path) = 0;

    /**
     * @brief Restores a soft-deleted node from trash back to active content.
     * @param trash_entry_id Identifier returned by delete_to_trash().
     * @param restore_path Destination relative path in active content.
     * @return Result<void> Success or ErrorCode.
     */
    virtual Result<void> restore_from_trash(
        const std::string& trash_entry_id,
        const std::string& restore_path
    ) = 0;

    /**
     * @brief Permanently purges a soft-deleted item from the trash folder.
     * @param trash_entry_id Identifier of the trash entry to purge.
     * @return Result<void> Success or ErrorCode.
     */
    virtual Result<void> purge_from_trash(const std::string& trash_entry_id) = 0;

    /**
     * @brief Lists all items currently in the trash bin.
     * @return Result<std::vector<NodeInfo>> Trash items with original paths in metadata.
     */
    virtual Result<std::vector<NodeInfo>> list_trash() = 0;

    /**
     * @brief Checks if a path is recognized as a document bundle.
     * @param relative_path Directory path to check.
     * @return Result<bool> True if bundle, false if standard directory or file.
     */
    virtual Result<bool> is_bundle(const std::string& relative_path) = 0;

    /**
     * @brief Creates an immutable date-partitioned snapshot under snapshots/YYYY/MM/...
     * @param relative_path Document path relative to content root.
     * @param content Snapshot content body.
     * @return Result<std::string> Relative snapshot path or ErrorCode.
     */
    virtual Result<std::string> create_snapshot(
        const std::string& relative_path,
        std::string_view content
    ) = 0;

    /**
     * @brief Persists binary CRDT document state for a document room.
     * @param doc_id Unique document identifier.
     * @param state_bytes Binary CRDT state bytes.
     * @return Result<void> Success or ErrorCode.
     */
    virtual Result<void> save_crdt_state(
        const std::string& doc_id,
        std::span<const uint8_t> state_bytes
    ) = 0;

    /**
     * @brief Loads persisted binary CRDT document state for a document room.
     * @param doc_id Unique document identifier.
     * @return Result<std::vector<uint8_t>> Binary CRDT state or NotFound.
     */
    virtual Result<std::vector<uint8_t>> load_crdt_state(
        const std::string& doc_id
    ) = 0;

    /**
     * @brief Deletes persisted binary CRDT document state for a document room.
     * @param doc_id Unique document identifier.
     * @return Result<void> Success or ErrorCode.
     */
    virtual Result<void> delete_crdt_state(
        const std::string& doc_id
    ) = 0;
};

} // namespace cme::storage
