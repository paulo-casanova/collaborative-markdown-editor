/**
 * @file connection_pool.hpp
 * @brief Thread-safe PostgreSQL connection pooling via libpqxx.
 */

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

/**
 * @class PooledConnection
 * @brief RAII handle wrapping an active pqxx::connection.
 * 
 * Automatically returns the underlying connection back to the owning
 * ConnectionPool upon destruction.
 */
class PooledConnection {
public:
    PooledConnection(std::shared_ptr<ConnectionPool> pool, std::unique_ptr<pqxx::connection> conn);
    ~PooledConnection();

    PooledConnection(const PooledConnection&) = delete;
    PooledConnection& operator=(const PooledConnection&) = delete;

    PooledConnection(PooledConnection&& other) noexcept;
    PooledConnection& operator=(PooledConnection&& other) noexcept;

    /**
     * @brief Access the underlying pqxx::connection reference.
     */
    [[nodiscard]] pqxx::connection& get() noexcept { return *conn_; }

    /**
     * @brief Arrow operator to access connection methods directly.
     */
    [[nodiscard]] pqxx::connection* operator->() noexcept { return conn_.get(); }

private:
    std::shared_ptr<ConnectionPool> pool_;
    std::unique_ptr<pqxx::connection> conn_;
};

/**
 * @class ConnectionPool
 * @brief Thread-safe manager of reusable PostgreSQL database connections.
 */
class ConnectionPool : public std::enable_shared_from_this<ConnectionPool> {
public:
    /**
     * @brief Factory method creating and eagerly initializing a connection pool.
     * @param connection_string PostgreSQL URI (e.g., "postgresql://user:pass@host:5432/db").
     * @param pool_size Maximum number of concurrent connections (default: 8).
     * @param timeout Maximum wait duration when acquiring a connection (default: 5000ms).
     * @return Shared pointer to the initialized ConnectionPool.
     */
    static std::shared_ptr<ConnectionPool> create(
        std::string connection_string,
        size_t pool_size = 8,
        std::chrono::milliseconds timeout = std::chrono::milliseconds(5000)
    );

    ~ConnectionPool();

    /**
     * @brief Acquires an idle connection from the pool, blocking up to the timeout.
     * @return PooledConnection RAII handle, or ErrorCode if timeout/failure occurs.
     */
    [[nodiscard]] Result<PooledConnection> acquire();

    /**
     * @brief Returns a connection back to the idle queue (called by PooledConnection destructor).
     * @param conn Connection pointer to release.
     */
    void release(std::unique_ptr<pqxx::connection> conn);

    /**
     * @brief Total capacity of the connection pool.
     */
    [[nodiscard]] size_t size() const noexcept;

    /**
     * @brief Number of currently idle connections available immediately.
     */
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
