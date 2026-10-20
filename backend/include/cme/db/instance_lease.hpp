#pragma once

#include "cme/common.hpp"
#include "cme/db/connection_pool.hpp"
#include <string>
#include <memory>
#include <atomic>
#include <thread>
#include <functional>
#include <condition_variable>
#include <mutex>

namespace cme::db {

class InstanceLeaseManager {
public:
    InstanceLeaseManager(
        std::shared_ptr<ConnectionPool> pool,
        std::string lease_name = "cme_server",
        int ttl_seconds = 10,
        int renew_interval_seconds = 3
    );

    ~InstanceLeaseManager();

    [[nodiscard]] const std::string& holder_id() const { return holder_id_; }
    [[nodiscard]] const std::string& lease_name() const { return lease_name_; }
    [[nodiscard]] bool is_held() const { return is_held_.load(); }

    Result<bool> acquire();
    Result<bool> renew();
    void release();

    void start_heartbeat(std::function<void()> on_lease_lost = nullptr);
    void stop();

private:
    std::shared_ptr<ConnectionPool> pool_;
    std::string lease_name_;
    std::string holder_id_;
    int ttl_seconds_;
    int renew_interval_seconds_;

    std::atomic<bool> is_held_{false};
    std::atomic<bool> running_{false};
    std::thread heartbeat_thread_;
    std::mutex cv_mtx_;
    std::condition_variable cv_;
    std::function<void()> on_lease_lost_;

    static std::string generate_holder_id();
};

} // namespace cme::db
