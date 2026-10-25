#include "cme/collab/persistence_worker.hpp"
#include <iostream>

namespace cme::collab {

PersistenceWorker::PersistenceWorker(
    std::shared_ptr<RoomManager> room_manager,
    std::shared_ptr<storage::IStorageBackend> storage,
    std::shared_ptr<db::ConnectionPool> db_pool,
    PersistenceConfig config
) : room_manager_(std::move(room_manager)),
    storage_(std::move(storage)),
    db_pool_(std::move(db_pool)),
    config_(config) {}

PersistenceWorker::~PersistenceWorker() {
    stop();
}

void PersistenceWorker::start() {
    if (is_running_.exchange(true)) {
        return;
    }
    worker_thread_ = std::thread(&PersistenceWorker::worker_loop, this);
}

void PersistenceWorker::stop() {
    if (is_running_.exchange(false)) {
        {
            std::lock_guard<std::mutex> lock(cv_mutex_);
            cv_.notify_all();
        }
        if (worker_thread_.joinable()) {
            worker_thread_.join();
        }
        flush_all_dirty();
    }
}

void PersistenceWorker::track_flush_failure(const std::string& doc_id) {
    if (doc_id.empty()) return;
    std::lock_guard lock(failed_mutex_);
    failed_flush_rooms_.insert(doc_id);
}

void PersistenceWorker::track_flush_success(const std::string& doc_id) {
    if (doc_id.empty()) return;
    std::lock_guard lock(failed_mutex_);
    failed_flush_rooms_.erase(doc_id);
}

std::vector<std::string> PersistenceWorker::failed_flush_rooms() const {
    std::lock_guard lock(failed_mutex_);
    return {failed_flush_rooms_.begin(), failed_flush_rooms_.end()};
}

Result<void> PersistenceWorker::flush_room(DocumentRoom& room) {
    if (!storage_) {
        track_flush_failure(room.document_id());
        return std::unexpected(ErrorCode::IoError);
    }

    std::string fs_path = room.fs_path();
    if (fs_path.empty() && db_pool_ && !room.document_id().empty()) {
        try {
            auto conn_res = db_pool_->acquire();
            if (conn_res.has_value()) {
                pqxx::work tx(conn_res->get());
                auto r = tx.exec_params(
                    "SELECT fs_path FROM documents WHERE id = $1::uuid;",
                    room.document_id()
                );
                if (!r.empty() && !r[0][0].is_null()) {
                    std::string recovered = r[0][0].as<std::string>();
                    if (!recovered.empty()) {
                        room.set_fs_path(recovered);
                        fs_path = recovered;
                        std::cout << "[INFO] PersistenceWorker recovered fs_path '" << fs_path
                                  << "' for room " << room.document_id() << " from database.\n";
                    }
                }
            }
        } catch (const std::exception& e) {
            std::cerr << "[ERROR] PersistenceWorker failed to query DB for fs_path of room "
                      << room.document_id() << ": " << e.what() << "\n";
        }
    }

    if (fs_path.empty()) {
        std::cerr << "[ERROR] PersistenceWorker cannot flush room " << room.document_id()
                  << ": fs_path is empty and cannot be resolved.\n";
        track_flush_failure(room.document_id());
        return std::unexpected(ErrorCode::InvalidArgument);
    }

    auto snapshot = room.take_persistence_snapshot();

    // Determine bundle path
    bool is_bundle = storage_->is_bundle(fs_path).value_or(false);
    std::string content_file = is_bundle ? (fs_path + "/index.md") : fs_path;

    // 1. Atomic write to active content storage
    auto write_res = storage_->write_file(content_file, snapshot.content, true);
    if (!write_res.has_value()) {
        std::cerr << "[ERROR] PersistenceWorker failed to write file: " << content_file << "\n";
        track_flush_failure(room.document_id());
        return write_res;
    }

    // 2. Persist binary CRDT state
    auto crdt_res = storage_->save_crdt_state(room.document_id(), snapshot.crdt_state);
    if (!crdt_res.has_value()) {
        std::cerr << "[WARN] PersistenceWorker failed to save CRDT state for: " << room.document_id() << "\n";
    }

    // 3. Create date-partitioned snapshot
    if (config_.enable_snapshots) {
        auto snap_res = storage_->create_snapshot(content_file, snapshot.content);
        if (snap_res.has_value()) {
            total_snapshots_++;
        } else {
            std::cerr << "[WARN] PersistenceWorker failed to create snapshot for: " << content_file << "\n";
        }
    }

    // 4. Update PostgreSQL updated_at timestamp
    if (db_pool_ && !room.document_id().empty()) {
        auto conn_res = db_pool_->acquire();
        if (conn_res.has_value()) {
            try {
                pqxx::work tx(conn_res->get());
                tx.exec_params(
                    "UPDATE documents SET updated_at = NOW() WHERE id = $1::uuid;",
                    room.document_id()
                );
                tx.commit();
            } catch (...) {}
        }
    }

    // 5. Mark room clean up to the snapshot sequence and clear flush failure
    room.mark_clean(snapshot.sequence);
    track_flush_success(room.document_id());
    total_flushes_++;
    return {};
}

size_t PersistenceWorker::flush_all_dirty() {
    if (!room_manager_) return 0;
    auto dirty_rooms = room_manager_->get_dirty_rooms();
    size_t flushed = 0;
    for (auto& room : dirty_rooms) {
        if (room && room->is_dirty()) {
            auto res = flush_room(*room);
            if (res.has_value()) {
                flushed++;
            }
        }
    }
    return flushed;
}

void PersistenceWorker::worker_loop() {
    while (is_running_) {
        {
            std::unique_lock<std::mutex> lock(cv_mutex_);
            cv_.wait_for(lock, config_.check_interval, [this]() {
                return !is_running_.load();
            });
        }

        if (!is_running_) break;

        if (paused_predicate_ && paused_predicate_()) continue;

        if (!room_manager_) continue;

        auto now = std::chrono::system_clock::now();
        auto all_rooms = room_manager_->get_all_rooms();
        std::vector<std::string> to_evict;

        for (auto& room : all_rooms) {
            if (!room) continue;

            // 1. Check debounced flush conditions
            if (room->is_dirty()) {
                auto idle_dur = std::chrono::duration_cast<std::chrono::milliseconds>(now - room->last_edit_time());
                auto flush_dur = std::chrono::duration_cast<std::chrono::milliseconds>(now - room->last_flush_time());

                if (idle_dur >= config_.idle_delay || flush_dur >= config_.max_interval) {
                    flush_room(*room);
                }
            }

            // 2. Check room eviction conditions
            if (config_.auto_evict_idle_rooms && room->peer_count() == 0) {
                // If a client connection is currently pending, skip eviction
                if (room->has_pending_connection()) {
                    auto pending_dur = std::chrono::duration_cast<std::chrono::seconds>(now - room->created_at());
                    if (pending_dur < std::chrono::seconds(60)) {
                        continue;
                    }
                }

                // If room has never had any connected peers, grant a grace period of 60 seconds
                if (!room->has_had_peers()) {
                    auto age = std::chrono::duration_cast<std::chrono::seconds>(now - room->created_at());
                    if (age < std::chrono::seconds(60)) {
                        continue;
                    }
                }

                // If room has had peers, ensure idle delay has passed
                if (room->has_had_peers()) {
                    auto idle_dur = std::chrono::duration_cast<std::chrono::milliseconds>(now - room->last_edit_time());
                    if (idle_dur < config_.idle_delay) {
                        continue;
                    }
                }

                // If still dirty after idle window, flush it before eviction
                if (room->is_dirty()) {
                    auto idle_dur = std::chrono::duration_cast<std::chrono::milliseconds>(now - room->last_edit_time());
                    if (idle_dur >= config_.idle_delay) {
                        flush_room(*room);
                    }
                }

                // If clean and has 0 peers, schedule eviction
                if (!room->is_dirty() && room->peer_count() == 0) {
                    to_evict.push_back(room->document_id());
                }
            }
        }

        // Execute room evictions
        for (const auto& doc_id : to_evict) {
            auto r = room_manager_->get_room(doc_id);
            if (r && r->peer_count() == 0 && !r->is_dirty()) {
                if (room_manager_->remove_room(doc_id)) {
                    total_evictions_++;
                }
            }
        }
    }
}

} // namespace cme::collab
