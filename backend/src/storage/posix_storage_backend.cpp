#include "cme/storage/posix_storage_backend.hpp"
#include <fstream>
#include <sstream>
#include <iomanip>
#include <random>
#include <thread>
#include <iostream>
#include <algorithm>

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

} // namespace

PosixStorageBackend::PosixStorageBackend(std::filesystem::path root_path)
    : root_path_(std::filesystem::absolute(root_path)),
      content_root_(root_path_ / "content"),
      trash_root_(root_path_ / "trash"),
      snapshots_root_(root_path_ / "snapshots"),
      backups_root_(root_path_ / "backups"),
      crdt_root_(root_path_ / "crdt") {
    
    std::filesystem::create_directories(content_root_);
    std::filesystem::create_directories(trash_root_);
    std::filesystem::create_directories(snapshots_root_);
    std::filesystem::create_directories(backups_root_);
    std::filesystem::create_directories(crdt_root_);
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
    if (filename.ends_with(".bundle")) {
        return true;
    }

    // Check for index.md
    if (std::filesystem::exists(full_path / "index.md")) {
        return true;
    }

    // Check for <dir_name>.md (e.g. project-alpha/project-alpha.md)
    if (std::filesystem::exists(full_path / (filename + ".md"))) {
        return true;
    }

    return false;
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
    auto target_res = resolve_safe_path(content_root_, relative_path);
    if (!target_res) return std::unexpected(target_res.error());
    const auto& target_path = *target_res;

    std::error_code ec;
    std::filesystem::create_directories(target_path.parent_path(), ec);
    if (ec) {
        std::cerr << "[ERROR] Failed to create directories for: " << target_path << " (" << ec.message() << ")\n";
        return std::unexpected(ErrorCode::IoError);
    }

    if (!atomic) {
        std::ofstream out(target_path, std::ios::binary | std::ios::trunc);
        if (!out) return std::unexpected(ErrorCode::IoError);
        out.write(content.data(), static_cast<std::streamsize>(content.size()));
        if (!out) return std::unexpected(ErrorCode::IoError);
        return {};
    }

    // Atomic write workflow: write to unique temporary file and rename
    std::ostringstream tmp_name;
    tmp_name << "." << target_path.filename().string()
             << "." << get_random_nonce() << ".tmp";
    auto tmp_path = target_path.parent_path() / tmp_name.str();

    {
        std::ofstream out(tmp_path, std::ios::binary | std::ios::trunc);
        if (!out) {
            std::cerr << "[ERROR] Could not open temp file for writing: " << tmp_path << "\n";
            return std::unexpected(ErrorCode::IoError);
        }
        out.write(content.data(), static_cast<std::streamsize>(content.size()));
        out.flush();
        if (!out) {
            std::filesystem::remove(tmp_path, ec);
            return std::unexpected(ErrorCode::IoError);
        }
    }

    {
        std::lock_guard<std::mutex> lock(mutex_);
        std::filesystem::rename(tmp_path, target_path, ec);
        if (ec) {
            std::cerr << "[ERROR] Atomic rename failed: " << tmp_path << " -> " << target_path
                      << " (" << ec.message() << ")\n";
            std::filesystem::remove(tmp_path, ec);
            return std::unexpected(ErrorCode::IoError);
        }
    }

    return {};
}

Result<std::string> PosixStorageBackend::read_file(const std::string& relative_path) {
    auto target_res = resolve_safe_path(content_root_, relative_path);
    if (!target_res) return std::unexpected(target_res.error());
    const auto& target_path = *target_res;

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
    auto target_res = resolve_safe_path(content_root_, relative_path);
    if (!target_res) return std::unexpected(target_res.error());
    const auto& target_path = *target_res;

    std::error_code ec;
    std::filesystem::create_directories(target_path, ec);
    if (ec) {
        return std::unexpected(ErrorCode::IoError);
    }
    return {};
}

Result<bool> PosixStorageBackend::exists(const std::string& relative_path) {
    auto target_res = resolve_safe_path(content_root_, relative_path);
    if (!target_res) return std::unexpected(target_res.error());
    std::error_code ec;
    return std::filesystem::exists(*target_res, ec);
}

Result<NodeInfo> PosixStorageBackend::get_node_info(const std::string& relative_path) {
    auto target_res = resolve_safe_path(content_root_, relative_path);
    if (!target_res) return std::unexpected(target_res.error());
    const auto& target_path = *target_res;

    std::error_code ec;
    if (!std::filesystem::exists(target_path, ec)) {
        return std::unexpected(ErrorCode::NotFound);
    }

    return make_node_info(content_root_, target_path);
}

Result<std::vector<NodeInfo>> PosixStorageBackend::list_directory(
    const std::string& relative_path,
    bool recursive
) {
    auto target_res = resolve_safe_path(content_root_, relative_path);
    if (!target_res) return std::unexpected(target_res.error());
    const auto& target_path = *target_res;

    std::error_code ec;
    if (!std::filesystem::exists(target_path, ec) || !std::filesystem::is_directory(target_path, ec)) {
        return std::unexpected(ErrorCode::NotFound);
    }

    std::vector<NodeInfo> results;
    if (recursive) {
        for (const auto& entry : std::filesystem::recursive_directory_iterator(target_path, ec)) {
            // Ignore hidden/temporary files
            if (entry.path().filename().string().starts_with(".")) continue;
            results.push_back(make_node_info(content_root_, entry.path()));
        }
    } else {
        for (const auto& entry : std::filesystem::directory_iterator(target_path, ec)) {
            if (entry.path().filename().string().starts_with(".")) continue;
            results.push_back(make_node_info(content_root_, entry.path()));
        }
    }

    std::sort(results.begin(), results.end(), [](const NodeInfo& a, const NodeInfo& b) {
        return a.relative_path < b.relative_path;
    });

    return results;
}

Result<void> PosixStorageBackend::move_node(
    const std::string& source_path,
    const std::string& destination_path
) {
    auto src_res = resolve_safe_path(content_root_, source_path);
    if (!src_res) return std::unexpected(src_res.error());
    const auto& src = *src_res;

    auto dst_res = resolve_safe_path(content_root_, destination_path);
    if (!dst_res) return std::unexpected(dst_res.error());
    const auto& dst = *dst_res;

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
        std::cerr << "[ERROR] Move operation failed: " << src << " -> " << dst
                  << " (" << ec.message() << ")\n";
        return std::unexpected(ErrorCode::IoError);
    }

    return {};
}

Result<std::string> PosixStorageBackend::delete_to_trash(const std::string& relative_path) {
    auto src_res = resolve_safe_path(content_root_, relative_path);
    if (!src_res) return std::unexpected(src_res.error());
    const auto& src = *src_res;

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
            std::cerr << "[ERROR] Failed to move node to trash: " << src << " -> " << trash_target
                      << " (" << ec.message() << ")\n";
            return std::unexpected(ErrorCode::IoError);
        }

        // Write metadata sidecar
        auto meta_path = trash_root_ / (trash_entry_id + ".meta");
        std::ofstream meta(meta_path);
        if (meta) {
            meta << "original_path=" << relative_path << "\n";
            meta << "deleted_at=" << timestamp << "\n";
        }
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

    auto dst_res = resolve_safe_path(content_root_, restore_path);
    if (!dst_res) return std::unexpected(dst_res.error());
    const auto& dst = *dst_res;

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
            return std::unexpected(ErrorCode::IoError);
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
    auto target_res = resolve_safe_path(content_root_, relative_path);
    if (!target_res) return std::unexpected(target_res.error());
    return is_bundle_path(*target_res);
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
    std::filesystem::path tmp_path = snap_dir / ("." + snap_filename + "." + std::to_string(get_random_nonce()) + ".tmp");

    {
        std::lock_guard<std::mutex> lock(mutex_);
        std::ofstream out(tmp_path, std::ios::binary | std::ios::trunc);
        if (!out.is_open()) {
            return std::unexpected(ErrorCode::IoError);
        }
        out.write(content.data(), static_cast<std::streamsize>(content.size()));
        out.flush();
        if (!out.good()) {
            std::filesystem::remove(tmp_path, ec);
            return std::unexpected(ErrorCode::IoError);
        }
        out.close();

        std::filesystem::rename(tmp_path, final_path, ec);
        if (ec) {
            std::filesystem::remove(tmp_path, ec);
            return std::unexpected(ErrorCode::IoError);
        }
    }

    std::string rel_result = std::string(year_str) + "/" + month_str + "/" + snap_filename;
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
    auto temp_path = crdt_root_ / (safe_name + ".tmp." + std::to_string(get_random_nonce()));

    std::error_code ec;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        std::ofstream out(temp_path, std::ios::binary | std::ios::trunc);
        if (!out.is_open()) {
            return std::unexpected(ErrorCode::IoError);
        }
        if (!state_bytes.empty()) {
            out.write(reinterpret_cast<const char*>(state_bytes.data()), static_cast<std::streamsize>(state_bytes.size()));
        }
        out.flush();
        if (!out.good()) {
            std::filesystem::remove(temp_path, ec);
            return std::unexpected(ErrorCode::IoError);
        }
        out.close();

        std::filesystem::rename(temp_path, target_path, ec);
        if (ec) {
            std::filesystem::remove(temp_path, ec);
            return std::unexpected(ErrorCode::IoError);
        }
    }
    return {};
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
