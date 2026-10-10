#pragma once

#include <string>
#include <memory>
#include <mutex>
#include <condition_variable>
#include <queue>
#include <chrono>
#include <expected>
#include <pqxx/pqxx>
#include "cme/common.hpp"

namespace cme::db {

class ConnectionPool;

class PooledConnection {
public:
    PooledConnection(std::shared_ptr<ConnectionPool> pool, std::unique_ptr<pqxx::connection> conn);
    ~PooledConnection();

    PooledConnection(const PooledConnection&) = delete;
    PooledConnection& operator=(const PooledConnection&) = delete;

    PooledConnection(PooledConnection&& other) noexcept;
    PooledConnection& operator=(PooledConnection&& other) noexcept;

    [[nodiscard]] pqxx::connection& get() noexcept { return *conn_; }
    [[nodiscard]] pqxx::connection* operator->() noexcept { return conn_.get(); }

private:
    std::shared_ptr<ConnectionPool> pool_;
    std::unique_ptr<pqxx::connection> conn_;
};

class ConnectionPool : public std::enable_shared_from_this<ConnectionPool> {
public:
    static std::shared_ptr<ConnectionPool> create(
        std::string connection_string,
        size_t pool_size = 8,
        std::chrono::milliseconds timeout = std::chrono::milliseconds(5000)
    );

    ~ConnectionPool();

    [[nodiscard]] Result<PooledConnection> acquire();

    void release(std::unique_ptr<pqxx::connection> conn);

    [[nodiscard]] size_t size() const noexcept;
    [[nodiscard]] size_t available() const noexcept;

private:
    ConnectionPool(std::string connection_string, size_t pool_size, std::chrono::milliseconds timeout);

    std::string connection_string_;
    size_t pool_size_;
    std::chrono::milliseconds timeout_;

    mutable std::mutex mutex_;
    std::condition_variable cv_;
    std::queue<std::unique_ptr<pqxx::connection>> pool_;
    bool shutting_down_{false};
};

} // namespace cme::db
