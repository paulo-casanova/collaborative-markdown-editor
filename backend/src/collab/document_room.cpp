#include "cme/collab/document_room.hpp"
#include <iostream>
#include <string_view>

namespace cme::collab {

namespace {

size_t count_substrings(std::string_view str, std::string_view sub) {
    if (sub.empty()) return 0;
    size_t count = 0;
    size_t pos = 0;
    while ((pos = str.find(sub, pos)) != std::string_view::npos) {
        count++;
        pos += sub.size();
    }
    return count;
}

std::string get_first_line(std::string_view text) {
    auto pos = text.find_first_of("\r\n");
    if (pos == std::string_view::npos) return std::string(text);
    return std::string(text.substr(0, pos));
}

} // namespace

DocumentRoom::DocumentRoom(
    std::string document_id,
    std::string initial_content,
    std::string fs_path,
    std::span<const uint8_t> initial_crdt_state
) : document_id_(std::move(document_id)),
    fs_path_(std::move(fs_path)),
    last_edit_time_(std::chrono::system_clock::now()),
    last_flush_time_(std::chrono::system_clock::now()) {
    if (!initial_crdt_state.empty()) {
        auto res = doc_.apply_update(initial_crdt_state);
        if (res.has_value()) {
            std::string converged = doc_.get_text();
            if (!initial_content.empty() && converged != initial_content) {
                doc_.set_text(initial_content);
                is_dirty_.store(true);
            }
            return;
        }
    }
    if (!initial_content.empty()) {
        doc_.insert_text(0, initial_content);
    }
}

std::string DocumentRoom::get_content() const {
    std::lock_guard lock(mutex_);
    return doc_.get_text();
}

void DocumentRoom::set_content(const std::string& content) {
    std::lock_guard lock(mutex_);
    doc_.set_text(content);
    is_dirty_.store(true);
    last_edit_time_ = std::chrono::system_clock::now();
}

void DocumentRoom::insert_text(uint32_t index, const std::string& text) {
    std::lock_guard lock(mutex_);
    doc_.insert_text(index, text);
    is_dirty_.store(true);
    last_edit_time_ = std::chrono::system_clock::now();
}

void DocumentRoom::delete_text(uint32_t index, uint32_t length) {
    std::lock_guard lock(mutex_);
    doc_.delete_text(index, length);
    is_dirty_.store(true);
    last_edit_time_ = std::chrono::system_clock::now();
}

std::vector<uint8_t> DocumentRoom::get_state_vector() const {
    std::lock_guard lock(mutex_);
    return doc_.get_state_vector();
}

std::vector<uint8_t> DocumentRoom::compute_sync_step2(std::span<const uint8_t> remote_sv) const {
    std::lock_guard lock(mutex_);
    return doc_.get_state_diff(remote_sv);
}

Result<void> DocumentRoom::apply_client_update(std::span<const uint8_t> update_data) {
    std::lock_guard lock(mutex_);
    std::string before = doc_.get_text();
    auto res = doc_.apply_update(update_data);
    if (!res.has_value()) {
        return res;
    }

    std::string after = doc_.get_text();

    // Check for duplicate merge corruption
    bool is_duplicated = false;

    // Condition 1: Direct doubling (before + before)
    if (!before.empty() && after.size() >= before.size() * 2) {
        if (after == before + before || after == before + "\n" + before || after == before + " " + before) {
            is_duplicated = true;
        }
    }

    // Condition 2: Primary heading duplication (# Heading)
    if (!is_duplicated && !before.empty()) {
        std::string heading = get_first_line(before);
        if (!heading.empty() && heading.starts_with("#")) {
            size_t count_before = count_substrings(before, heading);
            size_t count_after = count_substrings(after, heading);
            if (count_before == 1 && count_after > 1) {
                is_duplicated = true;
            }
        }
    }

    // Condition 3: Full text replication (before occurs multiple times in after)
    if (!is_duplicated && before.size() >= 10) {
        size_t count_before = count_substrings(before, before);
        size_t count_after = count_substrings(after, before);
        if (count_before == 1 && count_after > 1) {
            is_duplicated = true;
        }
    }

    if (is_duplicated) {
        std::cerr << "[DocumentRoom] Detected duplicate merge corruption in doc "
                  << document_id_ << "; rejecting duplicate update and restoring clean state.\n";
        doc_.set_text(before);
        is_dirty_.store(false);
        return res;
    }

    is_dirty_.store(true);
    last_edit_time_ = std::chrono::system_clock::now();
    return res;
}

void DocumentRoom::add_peer(
    const std::string& client_id,
    const std::string& username,
    const std::string& display_name,
    const std::string& avatar_color
) {
    std::lock_guard lock(mutex_);
    peers_[client_id] = PeerInfo{
        .client_id = client_id,
        .username = username,
        .display_name = display_name,
        .avatar_color = avatar_color,
        .joined_at = std::chrono::system_clock::now()
    };
}

void DocumentRoom::remove_peer(const std::string& client_id) {
    std::lock_guard lock(mutex_);
    peers_.erase(client_id);
}

size_t DocumentRoom::peer_count() const {
    std::lock_guard lock(mutex_);
    return peers_.size();
}

std::vector<PeerInfo> DocumentRoom::list_peers() const {
    std::lock_guard lock(mutex_);
    std::vector<PeerInfo> result;
    result.reserve(peers_.size());
    for (const auto& [_, peer] : peers_) {
        result.push_back(peer);
    }
    return result;
}

} // namespace cme::collab
