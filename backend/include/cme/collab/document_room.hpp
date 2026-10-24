/**
 * @file document_room.hpp
 * @brief Thread-safe in-memory collaborative document room coordinating YDoc and peer presence.
 */

#pragma once

#include "cme/collab/crdt_doc.hpp"
#include <string>
#include <vector>
#include <span>
#include <unordered_map>
#include <mutex>
#include <atomic>
#include <chrono>
#include <memory>
#include <nlohmann/json.hpp>

namespace cme::collab {

/**
 * @struct PeerInfo
 * @brief Active collaborator connected to a collaborative room.
 */
struct PeerInfo {
    std::string client_id;
    std::string username;
    std::string display_name;
    std::string avatar_color{"#3b82f6"};
    std::chrono::system_clock::time_point joined_at{std::chrono::system_clock::now()};

    [[nodiscard]] nlohmann::json to_json() const {
        return {
            {"client_id", client_id},
            {"username", username},
            {"display_name", display_name},
            {"avatar_color", avatar_color}
        };
    }
};

/**
 * @class DocumentRoom
 * @brief Coordinates in-memory CRDT synchronization, active peers, and dirty-state persistence tracking.
 */
class DocumentRoom {
public:
    explicit DocumentRoom(
        std::string document_id,
        std::string initial_content = "",
        std::string fs_path = "",
        std::span<const uint8_t> initial_crdt_state = {}
    );

    [[nodiscard]] const std::string& document_id() const noexcept { return document_id_; }
    [[nodiscard]] const std::string& fs_path() const noexcept { return fs_path_; }
    void set_fs_path(std::string path) {
        std::lock_guard lock(mutex_);
        fs_path_ = std::move(path);
    }

    /**
     * @brief Extracts current converged markdown text string.
     */
    [[nodiscard]] std::string get_content() const;

    /**
     * @brief Replaces the room's CRDT text with plain markdown text.
     */
    void set_content(const std::string& content);

    /**
     * @brief Inserts plain text into the collaborative document.
     */
    void insert_text(uint32_t index, const std::string& text);

    /**
     * @brief Removes a range of characters from the collaborative document.
     */
    void delete_text(uint32_t index, uint32_t length);

    /**
     * @brief Computes the lib0 v1 state vector representing this room's CRDT state.
     */
    [[nodiscard]] std::vector<uint8_t> get_state_vector() const;

    /**
     * @brief Computes missing deltas (SyncStep2) against a client's state vector.
     */
    [[nodiscard]] std::vector<uint8_t> compute_sync_step2(std::span<const uint8_t> remote_sv) const;

    /**
     * @brief Ingests an incoming binary CRDT update from a client and marks room as dirty.
     */
    Result<void> apply_client_update(std::span<const uint8_t> update_data);

    // Persistence & dirty lifecycle
    [[nodiscard]] bool is_dirty() const noexcept { return is_dirty_.load(); }
    void mark_clean() noexcept {
        is_dirty_.store(false);
        last_flush_time_ = std::chrono::system_clock::now();
    }
    [[nodiscard]] std::chrono::system_clock::time_point last_edit_time() const noexcept { return last_edit_time_; }
    [[nodiscard]] std::chrono::system_clock::time_point last_flush_time() const noexcept { return last_flush_time_; }
    [[nodiscard]] std::chrono::system_clock::time_point created_at() const noexcept { return created_at_; }
    [[nodiscard]] bool has_had_peers() const noexcept { return has_had_peers_.load(); }
    [[nodiscard]] bool has_pending_connection() const noexcept { return pending_connection_.load(); }
    void set_pending_connection(bool pending) noexcept { pending_connection_.store(pending); }

    // Peer presence
    void add_peer(const std::string& client_id, const std::string& username, const std::string& display_name, const std::string& avatar_color);
    void remove_peer(const std::string& client_id);
    [[nodiscard]] size_t peer_count() const;
    [[nodiscard]] std::vector<PeerInfo> list_peers() const;

    [[nodiscard]] CrdtDoc& doc() noexcept { return doc_; }
    [[nodiscard]] const CrdtDoc& doc() const noexcept { return doc_; }

private:
    std::string document_id_;
    std::string fs_path_;
    mutable std::mutex mutex_;
    CrdtDoc doc_;

    std::atomic<bool> is_dirty_{false};
    std::chrono::system_clock::time_point created_at_{std::chrono::system_clock::now()};
    std::atomic<bool> has_had_peers_{false};
    std::atomic<bool> pending_connection_{false};
    std::chrono::system_clock::time_point last_edit_time_;
    std::chrono::system_clock::time_point last_flush_time_;

    std::unordered_map<std::string, PeerInfo> peers_;
};

} // namespace cme::collab
