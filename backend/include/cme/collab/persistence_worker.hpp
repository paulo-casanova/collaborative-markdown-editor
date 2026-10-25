/**
 * @file persistence_worker.hpp
 * @brief Background debounced writer thread coordinating disk persistence, snapshots, and room eviction.
 */

#pragma once

#include "cme/collab/room_manager.hpp"
#include "cme/storage/storage_backend.hpp"
#include "cme/db/connection_pool.hpp"
#include <memory>
#include <atomic>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <chrono>
#include <unordered_set>
#include <vector>
#include <string>
#include <functional>

namespace cme::collab {

/**
 * @struct PersistenceConfig
 * @brief Operational parameters controlling debounced disk flushing, snapshots, and room eviction.
 */
struct PersistenceConfig {
    std::chrono::milliseconds idle_delay{5000};      ///< Inactivity window before flushing dirty room (5s).
    std::chrono::milliseconds max_interval{300000};  ///< Maximum interval before forcing flush of continuous edits (300s).
    std::chrono::milliseconds check_interval{200};   ///< Resolution of background evaluator loop (200ms).
    bool enable_snapshots{true};                     ///< Whether to generate date-partitioned snapshots.
    bool auto_evict_idle_rooms{true};                ///< Automatically evict rooms from RAM when all peers disconnect.
};

/**
 * @class PersistenceWorker
 * @brief Manages background thread flushing dirty in-memory collaborative rooms to POSIX storage.
 */
class PersistenceWorker {
public:
    PersistenceWorker(
        std::shared_ptr<RoomManager> room_manager,
        std::shared_ptr<storage::IStorageBackend> storage,
        std::shared_ptr<db::ConnectionPool> db_pool = nullptr,
        PersistenceConfig config = {}
    );

    ~PersistenceWorker();

    /**
     * @brief Starts the background debounced writer thread.
     */
    void start();

    /**
     * @brief Stops the background thread and executes a final flush of all dirty rooms.
     */
    void stop();

    [[nodiscard]] bool is_running() const noexcept { return is_running_.load(); }

    /**
     * @brief Synchronously flushes all currently dirty rooms to disk.
     * @return Number of rooms flushed.
     */
    size_t flush_all_dirty();

    /**
     * @brief Flushes a single room to disk, creates snapshot, and marks it clean.
     */
    Result<void> flush_room(DocumentRoom& room);

    void set_paused_predicate(std::function<bool()> predicate) {
        paused_predicate_ = std::move(predicate);
    }

    [[nodiscard]] const PersistenceConfig& config() const noexcept { return config_; }
    void set_config(PersistenceConfig cfg) noexcept { config_ = cfg; }

    [[nodiscard]] uint64_t total_flushes() const noexcept { return total_flushes_.load(); }
    [[nodiscard]] uint64_t total_snapshots() const noexcept { return total_snapshots_.load(); }
    [[nodiscard]] uint64_t total_evictions() const noexcept { return total_evictions_.load(); }
    [[nodiscard]] std::vector<std::string> failed_flush_rooms() const;

private:
    void worker_loop();
    void track_flush_failure(const std::string& doc_id);
    void track_flush_success(const std::string& doc_id);

    std::shared_ptr<RoomManager> room_manager_;
    std::shared_ptr<storage::IStorageBackend> storage_;
    std::shared_ptr<db::ConnectionPool> db_pool_;
    PersistenceConfig config_;

    std::atomic<bool> is_running_{false};
    std::thread worker_thread_;
    std::condition_variable cv_;
    std::mutex cv_mutex_;

    mutable std::mutex failed_mutex_;
    std::unordered_set<std::string> failed_flush_rooms_;

    std::atomic<uint64_t> total_flushes_{0};
    std::atomic<uint64_t> total_snapshots_{0};
    std::atomic<uint64_t> total_evictions_{0};
    std::function<bool()> paused_predicate_;
};

} // namespace cme::collab
