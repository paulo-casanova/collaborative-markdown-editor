#include "cme/collab/document_room.hpp"

namespace cme::collab {

DocumentRoom::DocumentRoom(
    std::string document_id,
    std::string initial_content,
    std::string fs_path
) : document_id_(std::move(document_id)),
    fs_path_(std::move(fs_path)),
    last_edit_time_(std::chrono::system_clock::now()),
    last_flush_time_(std::chrono::system_clock::now()) {
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
    auto res = doc_.apply_update(update_data);
    if (res.has_value()) {
        is_dirty_.store(true);
        last_edit_time_ = std::chrono::system_clock::now();
    }
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
