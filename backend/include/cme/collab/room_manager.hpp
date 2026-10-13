/**
 * @file room_manager.hpp
 * @brief Thread-safe coordinator for active in-memory DocumentRoom instances.
 */

#pragma once

#include "cme/collab/document_room.hpp"
#include <string>
#include <unordered_map>
#include <mutex>
#include <memory>
#include <vector>

namespace cme::collab {

/**
 * @class RoomManager
 * @brief Thread-safe manager coordinating all active in-memory collaborative document rooms.
 */
class RoomManager {
public:
    RoomManager() = default;

    /**
     * @brief Gets an existing room or instantiates a new DocumentRoom if not already open.
     */
    std::shared_ptr<DocumentRoom> get_or_create_room(
        const std::string& document_id,
        const std::string& initial_content = "",
        const std::string& fs_path = "",
        std::span<const uint8_t> initial_crdt_state = {}
    );

    /**
     * @brief Gets an existing room by document ID, or nullptr if not active in memory.
     */
    [[nodiscard]] std::shared_ptr<DocumentRoom> get_room(const std::string& document_id) const;

    /**
     * @brief Closes and evicts a room from in-memory coordination.
     */
    bool remove_room(const std::string& document_id);

    /**
     * @brief Collects all rooms currently marked as dirty (having unflushed edits).
     */
    [[nodiscard]] std::vector<std::shared_ptr<DocumentRoom>> get_dirty_rooms() const;

    /**
     * @brief Collects all active rooms currently managed in memory.
     */
    [[nodiscard]] std::vector<std::shared_ptr<DocumentRoom>> get_all_rooms() const;

    /**
     * @brief Returns total active collaborative room count.
     */
    [[nodiscard]] size_t active_room_count() const;

private:
    mutable std::mutex mutex_;
    std::unordered_map<std::string, std::shared_ptr<DocumentRoom>> rooms_;
};

} // namespace cme::collab
