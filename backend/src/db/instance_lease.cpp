#include "cme/db/instance_lease.hpp"
#include "cme/auth/crypto_utils.hpp"
#include <pqxx/pqxx>
#include <unistd.h>
#include <iostream>
#include <chrono>

namespace cme::db {

std::string InstanceLeaseManager::generate_holder_id() {
    char hostname[256];
    if (gethostname(hostname, sizeof(hostname)) != 0) {
        hostname[0] = '\0';
    }
    std::string host = hostname[0] ? hostname : "localhost";
    return host + ":" + std::to_string(getpid()) + ":" + auth::generate_random_token(8);
}

InstanceLeaseManager::InstanceLeaseManager(
    std::shared_ptr<ConnectionPool> pool,
    std::string lease_name,
    int ttl_seconds,
    int renew_interval_seconds
)
    : pool_(std::move(pool)),
      lease_name_(std::move(lease_name)),
      holder_id_(generate_holder_id()),
      ttl_seconds_(ttl_seconds),
      renew_interval_seconds_(renew_interval_seconds) {}

InstanceLeaseManager::~InstanceLeaseManager() {
    stop();
}

Result<bool> InstanceLeaseManager::acquire(bool log_warning) {
    if (!pool_) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    try {
        auto conn_wrapper = pool_->acquire();
        if (!conn_wrapper.has_value()) {
            return std::unexpected(ErrorCode::DatabaseError);
        }

        pqxx::work tx(conn_wrapper->get());

        // Ensure instance_lease table exists
        tx.exec(R"(
            CREATE TABLE IF NOT EXISTS instance_lease (
                lease_name VARCHAR(64) PRIMARY KEY,
                holder_id VARCHAR(128) NOT NULL,
                acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                renewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                expires_at TIMESTAMPTZ NOT NULL
            );
        )");

        // Attempt to upsert lease if expired or already held by us
        auto res = tx.exec_params(
            R"(
                INSERT INTO instance_lease (lease_name, holder_id, acquired_at, renewed_at, expires_at)
                VALUES ($1, $2, NOW(), NOW(), NOW() + ($3 * INTERVAL '1 second'))
                ON CONFLICT (lease_name) DO UPDATE
                SET holder_id = EXCLUDED.holder_id,
                    acquired_at = NOW(),
                    renewed_at = NOW(),
                    expires_at = EXCLUDED.expires_at
                WHERE instance_lease.expires_at < NOW() OR instance_lease.holder_id = EXCLUDED.holder_id
                RETURNING holder_id;
            )",
            lease_name_,
            holder_id_,
            ttl_seconds_
        );

        if (!res.empty()) {
            tx.commit();
            is_held_ = true;
            std::cout << "[INFO] Acquired instance lease '" << lease_name_
                      << "' as holder '" << holder_id_
                      << "' (TTL: " << ttl_seconds_ << "s).\n";
            return true;
        }

        // Another active instance holds the lease
        if (log_warning) {
            auto cur_res = tx.exec_params(
                "SELECT holder_id, expires_at FROM instance_lease WHERE lease_name = $1;",
                lease_name_
            );
            tx.commit();

            if (!cur_res.empty()) {
                std::string active_holder = cur_res[0]["holder_id"].c_str();
                std::string expires_at = cur_res[0]["expires_at"].c_str();
                std::cerr << "[WARN] Cannot acquire instance lease '" << lease_name_
                          << "': active lease held by '" << active_holder
                          << "' (expires at " << expires_at << ").\n";
            }
        } else {
            tx.commit();
        }

        is_held_ = false;
        return false;
    } catch (const std::exception& e) {
        if (log_warning) {
            std::cerr << "[ERROR] Exception during instance lease acquisition: " << e.what() << "\n";
        }
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

Result<bool> InstanceLeaseManager::acquire_or_wait(
    int retry_interval_seconds,
    int timeout_seconds,
    std::function<bool()> stop_check
) {
    if (retry_interval_seconds <= 0) {
        retry_interval_seconds = 1;
    }

    auto start_time = std::chrono::steady_clock::now();
    bool first_attempt = true;
    auto last_log_time = start_time;

    while (true) {
        if (stop_requested_ || (stop_check && stop_check())) {
            std::cout << "[INFO] Instance lease acquisition wait aborted (shutdown requested).\n";
            return false;
        }

        if (timeout_seconds > 0) {
            auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(
                std::chrono::steady_clock::now() - start_time
            ).count();
            if (elapsed >= timeout_seconds) {
                std::cerr << "[WARN] Timed out waiting for instance lease '" << lease_name_
                          << "' after " << elapsed << "s.\n";
                return false;
            }
        }

        // Try to acquire the lease. On first attempt, let acquire() log warning if held.
        auto acq_res = acquire(first_attempt);
        if (acq_res.has_value() && acq_res.value()) {
            if (!first_attempt) {
                auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(
                    std::chrono::steady_clock::now() - start_time
                ).count();
                std::cout << "[INFO] Successfully acquired instance lease '" << lease_name_
                          << "' after waiting " << elapsed << "s.\n";
            }
            return true;
        }

        if (first_attempt) {
            std::cout << "[INFO] Instance lease '" << lease_name_
                      << "' is currently held. Waiting for lease to become available...\n";
            first_attempt = false;
        } else {
            auto now = std::chrono::steady_clock::now();
            auto since_last_log = std::chrono::duration_cast<std::chrono::seconds>(
                now - last_log_time
            ).count();
            if (since_last_log >= 10) {
                auto total_elapsed = std::chrono::duration_cast<std::chrono::seconds>(
                    now - start_time
                ).count();
                std::cout << "[INFO] Still waiting for instance lease '" << lease_name_
                          << "' (elapsed: " << total_elapsed << "s)...\n";
                last_log_time = now;
            }
        }

        std::unique_lock<std::mutex> lock(cv_mtx_);
        cv_.wait_for(lock, std::chrono::seconds(retry_interval_seconds), [this, &stop_check]() {
            return stop_requested_.load() || (stop_check && stop_check());
        });
    }
}

Result<bool> InstanceLeaseManager::renew() {
    if (!pool_ || !is_held_) {
        return false;
    }

    try {
        auto conn_wrapper = pool_->acquire();
        if (!conn_wrapper.has_value()) {
            return std::unexpected(ErrorCode::DatabaseError);
        }

        pqxx::work tx(conn_wrapper->get());
        auto res = tx.exec_params(
            R"(
                UPDATE instance_lease
                SET renewed_at = NOW(),
                    expires_at = NOW() + ($3 * INTERVAL '1 second')
                WHERE lease_name = $1 AND holder_id = $2
                RETURNING holder_id;
            )",
            lease_name_,
            holder_id_,
            ttl_seconds_
        );

        if (!res.empty()) {
            tx.commit();
            return true;
        }

        tx.commit();
        is_held_ = false;
        return false;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] Exception during instance lease renewal: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

void InstanceLeaseManager::release() {
    if (!is_held_ || !pool_) {
        return;
    }

    try {
        auto conn_wrapper = pool_->acquire();
        if (conn_wrapper.has_value()) {
            pqxx::work tx(conn_wrapper->get());
            tx.exec_params(
                "DELETE FROM instance_lease WHERE lease_name = $1 AND holder_id = $2;",
                lease_name_,
                holder_id_
            );
            tx.commit();
            std::cout << "[INFO] Released instance lease '" << lease_name_
                      << "' for holder '" << holder_id_ << "'.\n";
        }
    } catch (const std::exception& e) {
        std::cerr << "[WARN] Exception during instance lease release: " << e.what() << "\n";
    }

    is_held_ = false;
}

void InstanceLeaseManager::start_heartbeat(std::function<void()> on_lease_lost) {
    if (running_) return;

    on_lease_lost_ = std::move(on_lease_lost);
    running_ = true;

    heartbeat_thread_ = std::thread([this]() {
        while (running_) {
            {
                std::unique_lock<std::mutex> lock(cv_mtx_);
                if (cv_.wait_for(lock, std::chrono::seconds(renew_interval_seconds_), [this]() {
                    return !running_;
                })) {
                    break;
                }
            }

            if (!running_) break;

            auto renew_res = renew();
            if (!renew_res.has_value() || !renew_res.value()) {
                std::cerr << "[CRITICAL] Failed to renew instance lease '" << lease_name_
                          << "'. Another instance may have claimed it or DB is unreachable.\n";
                is_held_ = false;
                if (on_lease_lost_) {
                    on_lease_lost_();
                }
                break;
            }
        }
    });
}

void InstanceLeaseManager::stop() {
    stop_requested_ = true;
    {
        std::lock_guard<std::mutex> lock(cv_mtx_);
        cv_.notify_all();
    }
    if (running_.exchange(false)) {
        if (heartbeat_thread_.joinable()) {
            if (std::this_thread::get_id() == heartbeat_thread_.get_id()) {
                heartbeat_thread_.detach();
            } else {
                heartbeat_thread_.join();
            }
        }
    }
    if (is_held_) {
        release();
    }
}

} // namespace cme::db
