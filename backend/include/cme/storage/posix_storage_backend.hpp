/**
 * @file posix_storage_backend.hpp
 * @brief Standard POSIX filesystem implementation of IStorageBackend.
 */

#pragma once

#include "cme/storage/storage_backend.hpp"
#include "cme/config/config.hpp"
#include <filesystem>
#include <mutex>
#include <vector>

namespace cme::storage {

/**
 * @class PosixStorageBackend
 * @brief Standard filesystem storage implementation using C++23 std::filesystem.
 * 
 * Organizes storage into four top-level folders:
 * - `content/`: The active document and directory tree.
 * - `trash/`: Soft-deleted files and bundles with timestamped prefixes.
 * - `snapshots/`: Date-partitioned historical document revisions.
 * - `backups/`: Scheduled tarball archives.
 * 
 * Guarantees crash consistency on writes using atomic temp file replacement via rename().
 */
class PosixStorageBackend : public IStorageBackend {
public:
    /**
     * @brief Constructs a POSIX storage backend anchored at the given root directory.
     * Automatically creates `content/`, `trash/`, `snapshots/`, and `backups/` if missing.
     * 
     * @param root_path Filesystem directory path for storage root.
     * @param mounts Optional additional directory mounts mapped to workspace prefixes.
     */
    explicit PosixStorageBackend(
        std::filesystem::path root_path,
        std::vector<config::StorageMountConfig> mounts = {}
    );

    ~PosixStorageBackend() override = default;

    Result<void> write_file(
        const std::string& relative_path,
        std::string_view content,
        bool atomic = true
    ) override;

    Result<std::string> read_file(const std::string& relative_path) override;

    Result<void> create_directory(const std::string& relative_path) override;

    Result<bool> exists(const std::string& relative_path) override;

    Result<NodeInfo> get_node_info(const std::string& relative_path) override;

    Result<std::vector<NodeInfo>> list_directory(
        const std::string& relative_path,
        bool recursive = false
    ) override;

    Result<void> move_node(
        const std::string& source_path,
        const std::string& destination_path
    ) override;

    Result<std::string> delete_to_trash(const std::string& relative_path) override;

    Result<void> restore_from_trash(
        const std::string& trash_entry_id,
        const std::string& restore_path
    ) override;

    Result<void> purge_from_trash(const std::string& trash_entry_id) override;

    Result<std::vector<NodeInfo>> list_trash() override;

    Result<bool> is_bundle(const std::string& relative_path) override;

    Result<std::string> create_snapshot(
        const std::string& relative_path,
        std::string_view content
    ) override;

    Result<void> save_crdt_state(
        const std::string& doc_id,
        std::span<const uint8_t> state_bytes
    ) override;

    Result<std::vector<uint8_t>> load_crdt_state(
        const std::string& doc_id
    ) override;

    Result<void> delete_crdt_state(
        const std::string& doc_id
    ) override;

    Result<StorageHealth> check_health() override;

    /**
     * @brief Access the configured root path.
     */
    [[nodiscard]] const std::filesystem::path& root_path() const noexcept { return root_path_; }

    /**
     * @brief Access the active content root path (root_path / "content").
     */
    [[nodiscard]] const std::filesystem::path& content_root() const noexcept { return content_root_; }

    /**
     * @brief Access the CRDT root path (root_path / "crdt").
     */
    [[nodiscard]] const std::filesystem::path& crdt_root() const noexcept { return crdt_root_; }

    /**
     * @brief Access the trash root path (root_path / "trash").
     */
    [[nodiscard]] const std::filesystem::path& trash_root() const noexcept { return trash_root_; }

    /**
     * @brief Access the snapshots root path (root_path / "snapshots").
     */
    [[nodiscard]] const std::filesystem::path& snapshots_root() const noexcept { return snapshots_root_; }

    /**
     * @brief Access the backups root path (root_path / "backups").
     */
    [[nodiscard]] const std::filesystem::path& backups_root() const noexcept { return backups_root_; }

    /**
     * @brief Access configured multi-mounts.
     */
    [[nodiscard]] const std::vector<config::StorageMountConfig>& mounts() const noexcept { return configured_mounts_; }

private:
    struct ResolvedMount {
        std::string prefix;
        std::filesystem::path path;
    };

    struct ResolvedWorkspacePath {
        std::filesystem::path physical_path;
        std::filesystem::path base_root;
        std::string mount_prefix;
        bool is_mount{false};
    };

    std::filesystem::path root_path_;
    std::filesystem::path content_root_;
    std::filesystem::path trash_root_;
    std::filesystem::path snapshots_root_;
    std::filesystem::path backups_root_;
    std::filesystem::path crdt_root_;

    std::vector<config::StorageMountConfig> configured_mounts_;
    std::vector<ResolvedMount> resolved_mounts_;

    mutable std::mutex mutex_;

    [[nodiscard]] Result<std::filesystem::path> resolve_safe_path(
        const std::filesystem::path& base_dir,
        const std::string& relative_path
    ) const;

    [[nodiscard]] Result<ResolvedWorkspacePath> resolve_workspace_path(
        const std::string& relative_path
    ) const;

    [[nodiscard]] bool is_bundle_path(const std::filesystem::path& full_path) const;
    [[nodiscard]] NodeInfo make_node_info(
        const std::filesystem::path& base_dir,
        const std::filesystem::path& full_path
    ) const;
};

} // namespace cme::storage
