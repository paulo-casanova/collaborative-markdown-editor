#include "cme/storage/posix_storage_backend.hpp"
#include <fstream>
#include <sstream>
#include <iomanip>
#include <random>
#include <thread>
#include <iostream>
#include <algorithm>
#include <unordered_set>
#if defined(_WIN32)
#include <io.h>
#define fsync _commit
#else
#include <fcntl.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/stat.h>
#endif

namespace cme::storage {

namespace {

std::string get_iso_timestamp_prefix() {
    auto now = std::chrono::system_clock::now();
    std::time_t t = std::chrono::system_clock::to_time_t(now);
    std::tm tm{};
#if defined(_WIN32)
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    std::ostringstream ss;
    ss << std::put_time(&tm, "%Y-%m-%d-%H-%M-%S");
    return ss.str();
}

uint64_t get_random_nonce() {
    static thread_local std::mt19937_64 rng(std::random_device{}());
    return rng();
}

std::string sanitize_path_for_id(std::string_view p) {
    std::string s(p);
    for (char& c : s) {
        if (c == '/' || c == '\\' || c == ':') {
            c = '_';
        }
    }
    return s;
}

Result<void> durable_atomic_write(
    const std::filesystem::path& target_path,
    std::span<const uint8_t> data
) {
    std::error_code ec;
    auto parent_dir = target_path.parent_path();
    if (parent_dir.empty()) {
        parent_dir = ".";
    }
    std::filesystem::create_directories(parent_dir, ec);
    if (ec) {
        std::cerr << "[ERROR] Failed to create directories for: " << target_path << " (" << ec.message() << ")\n";
        return std::unexpected(ErrorCode::IoError);
    }

    std::ostringstream tmp_name;
    tmp_name << "." << target_path.filename().string()
             << "." << get_random_nonce() << ".tmp";
    auto tmp_path = parent_dir / tmp_name.str();

    // 1. Open temporary file with O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC
    int fd = ::open(tmp_path.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644);
    if (fd < 0) {
        std::cerr << "[ERROR] Could not open temp file for writing: " << tmp_path << "\n";
        return std::unexpected(ErrorCode::IoError);
    }

    // 2. Write data completely
    const char* ptr = reinterpret_cast<const char*>(data.data());
    size_t remaining = data.size();
    while (remaining > 0) {
        ssize_t written = ::write(fd, ptr, remaining);
        if (written < 0) {
            if (errno == EINTR) continue;
            std::cerr << "[ERROR] Failed to write data to temp file: " << tmp_path << "\n";
            ::close(fd);
            std::filesystem::remove(tmp_path, ec);
            return std::unexpected(ErrorCode::IoError);
        }
        ptr += written;
        remaining -= static_cast<size_t>(written);
    }

    // 3. fsync the temporary file
    if (::fsync(fd) != 0) {
        if (errno != EINVAL && errno != ENOTSUP) {
            std::cerr << "[ERROR] fsync failed on temp file: " << tmp_path << "\n";
            ::close(fd);
            std::filesystem::remove(tmp_path, ec);
            return std::unexpected(ErrorCode::IoError);
        }
    }

    if (::close(fd) != 0) {
        std::cerr << "[ERROR] close failed on temp file: " << tmp_path << "\n";
        std::filesystem::remove(tmp_path, ec);
        return std::unexpected(ErrorCode::IoError);
    }

    // 4. Atomic rename over target path
    std::filesystem::rename(tmp_path, target_path, ec);
    if (ec) {
        std::cerr << "[ERROR] Atomic rename failed: " << tmp_path << " -> " << target_path
                  << " (" << ec.message() << ")\n";
        std::filesystem::remove(tmp_path, ec);
        return std::unexpected(ErrorCode::IoError);
    }

    // 5. fsync the parent directory to commit directory entry modifications
    int dir_fd = ::open(parent_dir.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dir_fd >= 0) {
        if (::fsync(dir_fd) != 0) {
            if (errno != EINVAL && errno != ENOTSUP && errno != EBADF) {
                std::cerr << "[WARN] fsync on directory failed: " << parent_dir << "\n";
            }
        }
        ::close(dir_fd);
    }

    return {};
}

Result<void> durable_atomic_write(
    const std::filesystem::path& target_path,
    std::string_view content
) {
    return durable_atomic_write(
        target_path,
        std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(content.data()), content.size())
    );
}

NodeInfo build_node_info(
    const std::filesystem::path& p,
    const std::string& ws_rel_path,
    bool is_bundle
) {
    NodeInfo info;
    info.name = p.filename().string();
    info.relative_path = ws_rel_path;
    std::replace(info.relative_path.begin(), info.relative_path.end(), '\\', '/');
    while (!info.relative_path.empty() && info.relative_path.front() == '/') {
        info.relative_path.erase(info.relative_path.begin());
    }
    std::error_code ec;
    info.is_directory = std::filesystem::is_directory(p, ec);
    info.is_bundle = is_bundle;
    info.size_bytes = info.is_directory ? 0 : std::filesystem::file_size(p, ec);
    auto ftime = std::filesystem::last_write_time(p, ec);
    if (!ec) {
        info.last_modified = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
            ftime - std::filesystem::file_time_type::clock::now() + std::chrono::system_clock::now()
        );
    }
    return info;
}

} // namespace

PosixStorageBackend::PosixStorageBackend(
    std::filesystem::path root_path,
    std::vector<config::StorageMountConfig> mounts
)   : root_path_(std::filesystem::absolute(root_path)),
      content_root_(root_path_ / "content"),
      trash_root_(root_path_ / "trash"),
      snapshots_root_(root_path_ / "snapshots"),
      backups_root_(root_path_ / "backups"),
      crdt_root_(root_path_ / "crdt"),
      configured_mounts_(std::move(mounts)) {
    
    std::filesystem::create_directories(content_root_);
    std::filesystem::create_directories(trash_root_);
    std::filesystem::create_directories(snapshots_root_);
    std::filesystem::create_directories(backups_root_);
    std::filesystem::create_directories(crdt_root_);

    for (const auto& m : configured_mounts_) {
        std::string p = m.prefix;
        std::replace(p.begin(), p.end(), '\\', '/');
        while (!p.empty() && (p.front() == '/' || std::isspace(static_cast<unsigned char>(p.front())))) p.erase(p.begin());
        while (!p.empty() && (p.back() == '/' || std::isspace(static_cast<unsigned char>(p.back())))) p.pop_back();
        if (p.empty() || p == "." || p == "..") continue;

        std::filesystem::path mpath = std::filesystem::absolute(m.path);
        std::error_code ec;
        std::filesystem::create_directories(mpath, ec);

        resolved_mounts_.push_back(ResolvedMount{
            .prefix = p,
            .path = mpath
        });
    }

    // Sort by prefix length descending, then alphabetically descending
    std::sort(resolved_mounts_.begin(), resolved_mounts_.end(), [](const ResolvedMount& a, const ResolvedMount& b) {
        if (a.prefix.length() != b.prefix.length()) {
            return a.prefix.length() > b.prefix.length();
        }
        return a.prefix > b.prefix;
    });
}

Result<PosixStorageBackend::ResolvedWorkspacePath> PosixStorageBackend::resolve_workspace_path(
    const std::string& relative_path
) const {
    std::string clean = relative_path;
    std::replace(clean.begin(), clean.end(), '\\', '/');
    while (!clean.empty() && clean.front() == '/') {
        clean.erase(clean.begin());
    }
    while (!clean.empty() && clean.back() == '/') {
        clean.pop_back();
    }

    // Check for directory traversal attempts
    std::filesystem::path rel_p(clean);
    for (const auto& part : rel_p) {
        if (part == "..") {
            return std::unexpected(ErrorCode::InvalidArgument);
        }
    }

    if (clean.empty() || clean == ".") {
        return ResolvedWorkspacePath{
            .physical_path = content_root_,
            .base_root = content_root_,
            .mount_prefix = "",
            .is_mount = false
        };
    }

    for (const auto& mount : resolved_mounts_) {
        if (clean == mount.prefix) {
            return ResolvedWorkspacePath{
                .physical_path = mount.path,
                .base_root = mount.path,
                .mount_prefix = mount.prefix,
                .is_mount = true
            };
        }
        if (clean.starts_with(mount.prefix + "/")) {
            std::string subpath = clean.substr(mount.prefix.length() + 1);
            return ResolvedWorkspacePath{
                .physical_path = mount.path / subpath,
                .base_root = mount.path,
                .mount_prefix = mount.prefix,
                .is_mount = true
            };
        }
    }

    return ResolvedWorkspacePath{
        .physical_path = content_root_ / clean,
        .base_root = content_root_,
        .mount_prefix = "",
        .is_mount = false
    };
}

Result<std::filesystem::path> PosixStorageBackend::resolve_safe_path(
    const std::filesystem::path& base_dir,
    const std::string& relative_path
) const {
    if (relative_path.empty()) {
        return base_dir;
    }

    std::filesystem::path rel(relative_path);
    if (rel.is_absolute()) {
        rel = rel.relative_path();
    }

    // Check for directory traversal attempts
    for (const auto& part : rel) {
        if (part == "..") {
            return std::unexpected(ErrorCode::InvalidArgument);
        }
    }

    auto full_path = base_dir / rel;
    return full_path;
}

bool PosixStorageBackend::is_bundle_path(const std::filesystem::path& full_path) const {
    if (!std::filesystem::is_directory(full_path)) {
        return false;
    }

    std::string filename = full_path.filename().string();
    return filename.ends_with(".bundle");
}

NodeInfo PosixStorageBackend::make_node_info(
    const std::filesystem::path& base_dir,
    const std::filesystem::path& full_path
) const {
    NodeInfo info;
    info.name = full_path.filename().string();
    info.relative_path = std::filesystem::relative(full_path, base_dir).string();
    info.is_directory = std::filesystem::is_directory(full_path);
    info.is_bundle = is_bundle_path(full_path);

    std::error_code ec;
    auto ftime = std::filesystem::last_write_time(full_path, ec);
    if (!ec) {
        auto sctp = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
            ftime - std::filesystem::file_time_type::clock::now() + std::chrono::system_clock::now()
        );
        info.last_modified = sctp;
    }

    if (!info.is_directory) {
        info.size_bytes = std::filesystem::file_size(full_path, ec);
    } else {
        info.size_bytes = 0;
    }

    return info;
}

Result<void> PosixStorageBackend::write_file(
    const std::string& relative_path,
    std::string_view content,
    bool atomic
) {
    auto target_res = resolve_workspace_path(relative_path);
    if (!target_res) return std::unexpected(target_res.error());
    const auto& target_path = target_res->physical_path;

    if (!atomic) {
        std::error_code ec;
        auto parent_dir = target_path.parent_path();
        if (parent_dir.empty()) parent_dir = ".";
        std::filesystem::create_directories(parent_dir, ec);
        if (ec) {
            std::cerr << "[ERROR] Failed to create directories for: " << target_path << " (" << ec.message() << ")\n";
            return std::unexpected(ErrorCode::IoError);
        }
        int fd = ::open(target_path.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644);
        if (fd < 0) return std::unexpected(ErrorCode::IoError);

        const char* ptr = content.data();
        size_t remaining = content.size();
        while (remaining > 0) {
            ssize_t written = ::write(fd, ptr, remaining);
            if (written < 0) {
                if (errno == EINTR) continue;
                ::close(fd);
                return std::unexpected(ErrorCode::IoError);
            }
            ptr += written;
            remaining -= static_cast<size_t>(written);
        }

        if (::fsync(fd) != 0) {
            if (errno != EINVAL && errno != ENOTSUP) {
                ::close(fd);
                return std::unexpected(ErrorCode::IoError);
            }
        }
        ::close(fd);
        return {};
    }

    std::lock_guard<std::mutex> lock(mutex_);
    return durable_atomic_write(target_path, content);
}

Result<std::string> PosixStorageBackend::read_file(const std::string& relative_path) {
    auto target_res = resolve_workspace_path(relative_path);
    if (!target_res) return std::unexpected(target_res.error());
    const auto& target_path = target_res->physical_path;

    std::error_code ec;
    if (!std::filesystem::exists(target_path, ec) || !std::filesystem::is_regular_file(target_path, ec)) {
        return std::unexpected(ErrorCode::NotFound);
    }

    std::ifstream in(target_path, std::ios::binary);
    if (!in) {
        return std::unexpected(ErrorCode::IoError);
    }

    std::ostringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

Result<void> PosixStorageBackend::create_directory(const std::string& relative_path) {
    auto target_res = resolve_workspace_path(relative_path);
    if (!target_res) return std::unexpected(target_res.error());
    const auto& target_path = target_res->physical_path;

    std::error_code ec;
    std::filesystem::create_directories(target_path, ec);
    if (ec) {
        return std::unexpected(ErrorCode::IoError);
    }
    return {};
}

Result<bool> PosixStorageBackend::exists(const std::string& relative_path) {
    auto target_res = resolve_workspace_path(relative_path);
    if (!target_res) return std::unexpected(target_res.error());
    std::error_code ec;
    return std::filesystem::exists(target_res->physical_path, ec);
}

Result<NodeInfo> PosixStorageBackend::get_node_info(const std::string& relative_path) {
    auto target_res = resolve_workspace_path(relative_path);
    if (!target_res) return std::unexpected(target_res.error());
    const auto& resolved = *target_res;

    std::error_code ec;
    if (!std::filesystem::exists(resolved.physical_path, ec)) {
        return std::unexpected(ErrorCode::NotFound);
    }

    if (resolved.is_mount && resolved.physical_path == resolved.base_root) {
        NodeInfo info;
        info.name = resolved.mount_prefix;
        auto slash = info.name.rfind('/');
        if (slash != std::string::npos) {
            info.name = info.name.substr(slash + 1);
        }
        info.relative_path = resolved.mount_prefix;
        info.is_directory = true;
        info.is_bundle = is_bundle_path(resolved.physical_path);
        info.size_bytes = 0;
        auto ftime = std::filesystem::last_write_time(resolved.physical_path, ec);
        if (!ec) {
            auto sctp = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
                ftime - std::filesystem::file_time_type::clock::now() + std::chrono::system_clock::now()
            );
            info.last_modified = sctp;
        }
        return info;
    } else if (resolved.is_mount) {
        NodeInfo info;
        info.name = resolved.physical_path.filename().string();
        std::string rel_to_mount = std::filesystem::relative(resolved.physical_path, resolved.base_root).string();
        std::replace(rel_to_mount.begin(), rel_to_mount.end(), '\\', '/');
        info.relative_path = resolved.mount_prefix + "/" + rel_to_mount;
        info.is_directory = std::filesystem::is_directory(resolved.physical_path, ec);
        info.is_bundle = is_bundle_path(resolved.physical_path);
        info.size_bytes = info.is_directory ? 0 : std::filesystem::file_size(resolved.physical_path, ec);
        auto ftime = std::filesystem::last_write_time(resolved.physical_path, ec);
        if (!ec) {
            auto sctp = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
                ftime - std::filesystem::file_time_type::clock::now() + std::chrono::system_clock::now()
            );
            info.last_modified = sctp;
        }
        return info;
    } else {
        auto info = make_node_info(content_root_, resolved.physical_path);
        if (info.relative_path == ".") {
            info.relative_path = "";
            info.name = "";
        }
        return info;
    }
}

Result<std::vector<NodeInfo>> PosixStorageBackend::list_directory(
    const std::string& relative_path,
    bool recursive
) {
    std::string clean = relative_path;
    std::replace(clean.begin(), clean.end(), '\\', '/');
    while (!clean.empty() && clean.front() == '/') clean.erase(clean.begin());
    while (!clean.empty() && clean.back() == '/') clean.pop_back();

    std::vector<NodeInfo> results;
    std::error_code ec;

    // Check if clean is root
    if (clean.empty() || clean == ".") {
        // 1. Scan content_root_
        if (std::filesystem::exists(content_root_, ec) && std::filesystem::is_directory(content_root_, ec)) {
            if (recursive) {
                for (const auto& entry : std::filesystem::recursive_directory_iterator(content_root_, ec)) {
                    if (entry.path().filename().string().starts_with(".")) continue;
                    std::string rel = std::filesystem::relative(entry.path(), content_root_).string();
                    results.push_back(build_node_info(entry.path(), rel, is_bundle_path(entry.path())));
                }
            } else {
                for (const auto& entry : std::filesystem::directory_iterator(content_root_, ec)) {
                    if (entry.path().filename().string().starts_with(".")) continue;
                    std::string rel = std::filesystem::relative(entry.path(), content_root_).string();
                    results.push_back(build_node_info(entry.path(), rel, is_bundle_path(entry.path())));
                }
            }
        }

        // 2. Add mounts
        for (const auto& mount : resolved_mounts_) {
            if (!std::filesystem::exists(mount.path, ec)) continue;

            if (!recursive) {
                // Immediate child for root
                std::string first_seg = mount.prefix;
                auto slash = first_seg.find('/');
                if (slash != std::string::npos) {
                    first_seg = first_seg.substr(0, slash);
                }
                NodeInfo m_info;
                m_info.name = first_seg;
                m_info.relative_path = first_seg;
                m_info.is_directory = true;
                m_info.is_bundle = is_bundle_path(mount.path);
                m_info.size_bytes = 0;
                auto ftime = std::filesystem::last_write_time(mount.path, ec);
                if (!ec) {
                    m_info.last_modified = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
                        ftime - std::filesystem::file_time_type::clock::now() + std::chrono::system_clock::now()
                    );
                }
                results.push_back(m_info);
            } else {
                // Recursive: add mount node itself
                NodeInfo m_info;
                m_info.name = mount.prefix;
                auto last_slash = m_info.name.rfind('/');
                if (last_slash != std::string::npos) {
                    m_info.name = m_info.name.substr(last_slash + 1);
                }
                m_info.relative_path = mount.prefix;
                m_info.is_directory = true;
                m_info.is_bundle = is_bundle_path(mount.path);
                m_info.size_bytes = 0;
                auto ftime = std::filesystem::last_write_time(mount.path, ec);
                if (!ec) {
                    m_info.last_modified = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
                        ftime - std::filesystem::file_time_type::clock::now() + std::chrono::system_clock::now()
                    );
                }
                results.push_back(m_info);

                // And all its children recursively
                for (const auto& entry : std::filesystem::recursive_directory_iterator(mount.path, ec)) {
                    if (entry.path().filename().string().starts_with(".")) continue;
                    std::string rel_to_mount = std::filesystem::relative(entry.path(), mount.path).string();
                    std::replace(rel_to_mount.begin(), rel_to_mount.end(), '\\', '/');
                    std::string ws_rel = mount.prefix + "/" + rel_to_mount;
                    results.push_back(build_node_info(entry.path(), ws_rel, is_bundle_path(entry.path())));
                }
            }
        }
    } else {
        // Not root: check if it resolves to a mount or inside a mount
        auto target_res = resolve_workspace_path(clean);
        if (!target_res) return std::unexpected(target_res.error());
        const auto& resolved = *target_res;

        bool found_any = false;

        if (std::filesystem::exists(resolved.physical_path, ec) && std::filesystem::is_directory(resolved.physical_path, ec)) {
            found_any = true;
            if (recursive) {
                for (const auto& entry : std::filesystem::recursive_directory_iterator(resolved.physical_path, ec)) {
                    if (entry.path().filename().string().starts_with(".")) continue;
                    std::string rel_to_base = std::filesystem::relative(entry.path(), resolved.base_root).string();
                    std::replace(rel_to_base.begin(), rel_to_base.end(), '\\', '/');
                    std::string ws_rel = resolved.is_mount ? (resolved.mount_prefix + "/" + rel_to_base) : rel_to_base;
                    results.push_back(build_node_info(entry.path(), ws_rel, is_bundle_path(entry.path())));
                }
            } else {
                for (const auto& entry : std::filesystem::directory_iterator(resolved.physical_path, ec)) {
                    if (entry.path().filename().string().starts_with(".")) continue;
                    std::string rel_to_base = std::filesystem::relative(entry.path(), resolved.base_root).string();
                    std::replace(rel_to_base.begin(), rel_to_base.end(), '\\', '/');
                    std::string ws_rel = resolved.is_mount ? (resolved.mount_prefix + "/" + rel_to_base) : rel_to_base;
                    results.push_back(build_node_info(entry.path(), ws_rel, is_bundle_path(entry.path())));
                }
            }
        }

        // Also check if any mount has prefix starting with clean + "/" (e.g. clean is a virtual folder)
        std::string prefix_check = clean + "/";
        for (const auto& mount : resolved_mounts_) {
            if (mount.prefix.starts_with(prefix_check)) {
                found_any = true;
                std::string remainder = mount.prefix.substr(prefix_check.length());
                if (!recursive) {
                    auto slash = remainder.find('/');
                    std::string child_name = (slash != std::string::npos) ? remainder.substr(0, slash) : remainder;
                    NodeInfo m_info;
                    m_info.name = child_name;
                    m_info.relative_path = clean + "/" + child_name;
                    m_info.is_directory = true;
                    m_info.is_bundle = is_bundle_path(mount.path);
                    m_info.size_bytes = 0;
                    results.push_back(m_info);
                } else {
                    NodeInfo m_info;
                    m_info.name = mount.prefix.substr(mount.prefix.rfind('/') + 1);
                    m_info.relative_path = mount.prefix;
                    m_info.is_directory = true;
                    m_info.is_bundle = is_bundle_path(mount.path);
                    m_info.size_bytes = 0;
                    results.push_back(m_info);

                    for (const auto& entry : std::filesystem::recursive_directory_iterator(mount.path, ec)) {
                        if (entry.path().filename().string().starts_with(".")) continue;
                        std::string rel_to_mount = std::filesystem::relative(entry.path(), mount.path).string();
                        std::replace(rel_to_mount.begin(), rel_to_mount.end(), '\\', '/');
                        std::string ws_rel = mount.prefix + "/" + rel_to_mount;
                        results.push_back(build_node_info(entry.path(), ws_rel, is_bundle_path(entry.path())));
                    }
                }
            }
        }

        if (!found_any) {
            return std::unexpected(ErrorCode::NotFound);
        }
    }

    // Deduplicate by relative_path
    std::unordered_set<std::string> seen;
    std::vector<NodeInfo> unique_results;
    unique_results.reserve(results.size());
    for (auto& item : results) {
        if (seen.insert(item.relative_path).second) {
            unique_results.push_back(std::move(item));
        }
    }

    std::sort(unique_results.begin(), unique_results.end(), [](const NodeInfo& a, const NodeInfo& b) {
        return a.relative_path < b.relative_path;
    });

    return unique_results;
}

Result<void> PosixStorageBackend::move_node(
    const std::string& source_path,
    const std::string& destination_path
) {
    auto src_res = resolve_workspace_path(source_path);
    if (!src_res) return std::unexpected(src_res.error());
    const auto& src = src_res->physical_path;

    auto dst_res = resolve_workspace_path(destination_path);
    if (!dst_res) return std::unexpected(dst_res.error());
    const auto& dst = dst_res->physical_path;

    if (src == dst) {
        return {};
    }

    std::error_code ec;
    if (!std::filesystem::exists(src, ec)) {
        return std::unexpected(ErrorCode::NotFound);
    }
    if (std::filesystem::exists(dst, ec)) {
        return std::unexpected(ErrorCode::AlreadyExists);
    }

    std::filesystem::create_directories(dst.parent_path(), ec);
    if (ec) {
        return std::unexpected(ErrorCode::IoError);
    }

    std::lock_guard<std::mutex> lock(mutex_);
    std::filesystem::rename(src, dst, ec);
    if (ec) {
        // Fallback for cross-device or cross-mount moves
        std::error_code copy_ec;
        std::filesystem::copy(src, dst, std::filesystem::copy_options::recursive, copy_ec);
        if (copy_ec) {
            std::cerr << "[ERROR] Move operation failed: " << src << " -> " << dst
                      << " (" << copy_ec.message() << ")\n";
            std::error_code rm_ec;
            std::filesystem::remove_all(dst, rm_ec);
            return std::unexpected(ErrorCode::IoError);
        }
        std::error_code rm_src_ec;
        std::filesystem::remove_all(src, rm_src_ec);
        if (rm_src_ec) {
            std::cerr << "[WARN] Failed to delete source after copy move: " << src
                      << " (" << rm_src_ec.message() << ")\n";
        }
    }

    return {};
}

Result<std::string> PosixStorageBackend::delete_to_trash(const std::string& relative_path) {
    auto src_res = resolve_workspace_path(relative_path);
    if (!src_res) return std::unexpected(src_res.error());
    const auto& src = src_res->physical_path;

    std::error_code ec;
    if (!std::filesystem::exists(src, ec)) {
        return std::unexpected(ErrorCode::NotFound);
    }

    std::string timestamp = get_iso_timestamp_prefix();
    std::string clean_name = sanitize_path_for_id(relative_path);
    std::string trash_entry_id = timestamp + "_" + clean_name;

    auto trash_target = trash_root_ / trash_entry_id;

    {
        std::lock_guard<std::mutex> lock(mutex_);
        std::filesystem::rename(src, trash_target, ec);
        if (ec) {
            // Cross-device fallback for external mounts
            std::error_code copy_ec;
            std::filesystem::copy(src, trash_target, std::filesystem::copy_options::recursive, copy_ec);
            if (copy_ec) {
                std::cerr << "[ERROR] Failed to move node to trash: " << src << " -> " << trash_target
                          << " (" << copy_ec.message() << ")\n";
                std::filesystem::remove_all(trash_target, ec);
                return std::unexpected(ErrorCode::IoError);
            }
            std::filesystem::remove_all(src, ec);
        }

        // Write metadata sidecar
        auto meta_path = trash_root_ / (trash_entry_id + ".meta");
        std::ostringstream meta_ss;
        meta_ss << "original_path=" << relative_path << "\n";
        meta_ss << "deleted_at=" << timestamp << "\n";
        durable_atomic_write(meta_path, meta_ss.str());
    }

    return trash_entry_id;
}

Result<void> PosixStorageBackend::restore_from_trash(
    const std::string& trash_entry_id,
    const std::string& restore_path
) {
    auto trash_src_res = resolve_safe_path(trash_root_, trash_entry_id);
    if (!trash_src_res) return std::unexpected(trash_src_res.error());
    const auto& trash_src = *trash_src_res;

    auto dst_res = resolve_workspace_path(restore_path);
    if (!dst_res) return std::unexpected(dst_res.error());
    const auto& dst = dst_res->physical_path;

    std::error_code ec;
    if (!std::filesystem::exists(trash_src, ec)) {
        return std::unexpected(ErrorCode::NotFound);
    }
    if (std::filesystem::exists(dst, ec)) {
        return std::unexpected(ErrorCode::AlreadyExists);
    }

    std::filesystem::create_directories(dst.parent_path(), ec);
    if (ec) {
        return std::unexpected(ErrorCode::IoError);
    }

    {
        std::lock_guard<std::mutex> lock(mutex_);
        std::filesystem::rename(trash_src, dst, ec);
        if (ec) {
            // Cross-device fallback
            std::error_code copy_ec;
            std::filesystem::copy(trash_src, dst, std::filesystem::copy_options::recursive, copy_ec);
            if (copy_ec) {
                std::filesystem::remove_all(dst, ec);
                return std::unexpected(ErrorCode::IoError);
            }
            std::filesystem::remove_all(trash_src, ec);
        }

        // Clean up metadata sidecar if present
        auto meta_path = trash_root_ / (trash_entry_id + ".meta");
        std::filesystem::remove(meta_path, ec);
    }

    return {};
}

Result<void> PosixStorageBackend::purge_from_trash(const std::string& trash_entry_id) {
    auto trash_src_res = resolve_safe_path(trash_root_, trash_entry_id);
    if (!trash_src_res) return std::unexpected(trash_src_res.error());
    const auto& trash_src = *trash_src_res;

    std::error_code ec;
    if (!std::filesystem::exists(trash_src, ec)) {
        return std::unexpected(ErrorCode::NotFound);
    }

    {
        std::lock_guard<std::mutex> lock(mutex_);
        std::filesystem::remove_all(trash_src, ec);
        if (ec) {
            return std::unexpected(ErrorCode::IoError);
        }

        auto meta_path = trash_root_ / (trash_entry_id + ".meta");
        std::filesystem::remove(meta_path, ec);
    }

    return {};
}

Result<std::vector<NodeInfo>> PosixStorageBackend::list_trash() {
    std::error_code ec;
    std::vector<NodeInfo> results;

    for (const auto& entry : std::filesystem::directory_iterator(trash_root_, ec)) {
        std::string filename = entry.path().filename().string();
        if (filename.ends_with(".meta") || filename.starts_with(".")) {
            continue;
        }

        auto info = make_node_info(trash_root_, entry.path());

        // Check for original path in metadata sidecar
        auto meta_path = trash_root_ / (filename + ".meta");
        if (std::filesystem::exists(meta_path, ec)) {
            std::ifstream meta(meta_path);
            std::string line;
            while (std::getline(meta, line)) {
                if (line.starts_with("original_path=")) {
                    info.relative_path = line.substr(14);
                    break;
                }
            }
        }

        results.push_back(info);
    }

    std::sort(results.begin(), results.end(), [](const NodeInfo& a, const NodeInfo& b) {
        return a.name < b.name;
    });

    return results;
}

Result<bool> PosixStorageBackend::is_bundle(const std::string& relative_path) {
    auto target_res = resolve_workspace_path(relative_path);
    if (!target_res) return std::unexpected(target_res.error());
    return is_bundle_path(target_res->physical_path);
}

Result<std::string> PosixStorageBackend::create_snapshot(
    const std::string& relative_path,
    std::string_view content
) {
    if (relative_path.empty()) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    auto now = std::chrono::system_clock::now();
    std::time_t tt = std::chrono::system_clock::to_time_t(now);
    std::tm tm_buf{};
    gmtime_r(&tt, &tm_buf);

    char year_str[8];
    char month_str[8];
    char ts_str[32];
    std::strftime(year_str, sizeof(year_str), "%Y", &tm_buf);
    std::strftime(month_str, sizeof(month_str), "%m", &tm_buf);
    std::strftime(ts_str, sizeof(ts_str), "%Y-%m-%d-%H-%M-%S", &tm_buf);

    std::filesystem::path snap_dir = snapshots_root_ / year_str / month_str;
    std::error_code ec;
    std::filesystem::create_directories(snap_dir, ec);
    if (ec) {
        return std::unexpected(ErrorCode::IoError);
    }

    std::string sanitized = sanitize_path_for_id(relative_path);
    if (!sanitized.ends_with(".md")) {
        sanitized += ".md";
    }
    std::string snap_filename = std::string(ts_str) + "_" + sanitized;
    std::filesystem::path final_path = snap_dir / snap_filename;

    std::string rel_result = std::string(year_str) + "/" + month_str + "/" + snap_filename;
    std::lock_guard<std::mutex> lock(mutex_);
    auto write_res = durable_atomic_write(final_path, content);
    if (!write_res.has_value()) {
        return std::unexpected(write_res.error());
    }

    return rel_result;
}

Result<void> PosixStorageBackend::save_crdt_state(
    const std::string& doc_id,
    std::span<const uint8_t> state_bytes
) {
    if (doc_id.empty()) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }
    std::string safe_name = sanitize_path_for_id(doc_id) + ".bin";
    auto target_path = crdt_root_ / safe_name;

    std::lock_guard<std::mutex> lock(mutex_);
    return durable_atomic_write(target_path, state_bytes);
}

Result<std::vector<uint8_t>> PosixStorageBackend::load_crdt_state(
    const std::string& doc_id
) {
    if (doc_id.empty()) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }
    std::string safe_name = sanitize_path_for_id(doc_id) + ".bin";
    auto target_path = crdt_root_ / safe_name;

    std::lock_guard<std::mutex> lock(mutex_);
    if (!std::filesystem::exists(target_path)) {
        return std::unexpected(ErrorCode::NotFound);
    }

    std::ifstream in(target_path, std::ios::binary | std::ios::ate);
    if (!in.is_open()) {
        return std::unexpected(ErrorCode::IoError);
    }
    auto size = in.tellg();
    if (size < 0) {
        return std::unexpected(ErrorCode::IoError);
    }
    if (size == 0) {
        return std::vector<uint8_t>{};
    }
    in.seekg(0, std::ios::beg);
    std::vector<uint8_t> buffer(static_cast<size_t>(size));
    if (!in.read(reinterpret_cast<char*>(buffer.data()), size)) {
        return std::unexpected(ErrorCode::IoError);
    }
    return buffer;
}

Result<void> PosixStorageBackend::delete_crdt_state(
    const std::string& doc_id
) {
    if (doc_id.empty()) {
        return std::unexpected(ErrorCode::InvalidArgument);
    }
    std::string safe_name = sanitize_path_for_id(doc_id) + ".bin";
    auto target_path = crdt_root_ / safe_name;

    std::lock_guard<std::mutex> lock(mutex_);
    std::error_code ec;
    std::filesystem::remove(target_path, ec);
    return {};
}

Result<StorageHealth> PosixStorageBackend::check_health() {
    StorageHealth health;
    health.backend_type = "posix";

    std::lock_guard<std::mutex> lock(mutex_);
    std::error_code ec;
    auto space = std::filesystem::space(content_root_, ec);
    if (!ec) {
        health.status = "writable";
        health.free_bytes = space.available;
        health.total_bytes = space.capacity;
    } else {
        health.status = "error";
        health.message = ec.message();
    }
    return health;
}

} // namespace cme::storage
