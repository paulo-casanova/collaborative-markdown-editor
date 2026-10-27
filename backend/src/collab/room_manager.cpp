#include "cme/collab/room_manager.hpp"
#include <iostream>

namespace cme::collab {

std::shared_ptr<DocumentRoom> RoomManager::get_or_create_room(
    const std::string& document_id,
    const std::string& initial_content,
    const std::string& fs_path,
    std::span<const uint8_t> initial_crdt_state
) {
    std::lock_guard lock(mutex_);
    auto it = rooms_.find(document_id);
    if (it != rooms_.end()) {
        return it->second;
    }

    auto room = std::make_shared<DocumentRoom>(document_id, initial_content, fs_path, initial_crdt_state);
    rooms_[document_id] = room;
    std::cout << "[INFO] [ROOM] Created collaborative room for document " << document_id
              << (fs_path.empty() ? "" : " (path: '" + fs_path + "')") << "\n";
    return room;
}

std::shared_ptr<DocumentRoom> RoomManager::get_room(const std::string& document_id) const {
    std::lock_guard lock(mutex_);
    auto it = rooms_.find(document_id);
    if (it != rooms_.end()) {
        return it->second;
    }
    return nullptr;
}

bool RoomManager::remove_room(const std::string& document_id) {
    std::lock_guard lock(mutex_);
    bool removed = rooms_.erase(document_id) > 0;
    if (removed) {
        std::cout << "[INFO] [ROOM] Evicted collaborative room for document " << document_id << "\n";
    }
    return removed;
}

std::vector<std::shared_ptr<DocumentRoom>> RoomManager::get_dirty_rooms() const {
    std::lock_guard lock(mutex_);
    std::vector<std::shared_ptr<DocumentRoom>> dirty;
    for (const auto& [_, room] : rooms_) {
        if (room && room->is_dirty()) {
            dirty.push_back(room);
        }
    }
    return dirty;
}

std::vector<std::shared_ptr<DocumentRoom>> RoomManager::get_all_rooms() const {
    std::lock_guard lock(mutex_);
    std::vector<std::shared_ptr<DocumentRoom>> all;
    all.reserve(rooms_.size());
    for (const auto& [_, room] : rooms_) {
        if (room) {
            all.push_back(room);
        }
    }
    return all;
}

size_t RoomManager::active_room_count() const {
    std::lock_guard lock(mutex_);
    return rooms_.size();
}

} // namespace cme::collab
