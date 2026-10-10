#include "cme/db/connection_pool.hpp"
#include <iostream>

namespace cme::db {

PooledConnection::PooledConnection(std::shared_ptr<ConnectionPool> pool, std::unique_ptr<pqxx::connection> conn)
    : pool_(std::move(pool)), conn_(std::move(conn)) {}

PooledConnection::~PooledConnection() {
    if (pool_ && conn_) {
        pool_->release(std::move(conn_));
    }
}

PooledConnection::PooledConnection(PooledConnection&& other) noexcept
    : pool_(std::move(other.pool_)), conn_(std::move(other.conn_)) {}

PooledConnection& PooledConnection::operator=(PooledConnection&& other) noexcept {
    if (this != &other) {
        if (pool_ && conn_) {
            pool_->release(std::move(conn_));
        }
        pool_ = std::move(other.pool_);
        conn_ = std::move(other.conn_);
    }
    return *this;
}

std::shared_ptr<ConnectionPool> ConnectionPool::create(
    std::string connection_string,
    size_t pool_size,
    std::chrono::milliseconds timeout
) {
    auto pool = std::shared_ptr<ConnectionPool>(
        new ConnectionPool(std::move(connection_string), pool_size, timeout)
    );

    // Eagerly populate pool
    for (size_t i = 0; i < pool_size; ++i) {
        try {
            auto conn = std::make_unique<pqxx::connection>(pool->connection_string_);
            pool->pool_.push(std::move(conn));
        } catch (const std::exception& e) {
            std::cerr << "[ERROR] Failed to establish initial PostgreSQL connection: " << e.what() << "\n";
            throw;
        }
    }

    return pool;
}

ConnectionPool::ConnectionPool(std::string connection_string, size_t pool_size, std::chrono::milliseconds timeout)
    : connection_string_(std::move(connection_string)), pool_size_(pool_size), timeout_(timeout) {}

ConnectionPool::~ConnectionPool() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        shutting_down_ = true;
        while (!pool_.empty()) {
            pool_.pop();
        }
    }
    cv_.notify_all();
}

Result<PooledConnection> ConnectionPool::acquire() {
    std::unique_lock<std::mutex> lock(mutex_);

    bool acquired = cv_.wait_for(lock, timeout_, [this] {
        return !pool_.empty() || shutting_down_;
    });

    if (shutting_down_) {
        return std::unexpected(ErrorCode::InternalError);
    }

    if (!acquired || pool_.empty()) {
        return std::unexpected(ErrorCode::DatabaseError);
    }

    auto conn = std::move(pool_.front());
    pool_.pop();

    // Verify connection health; reconnect if broken
    if (!conn->is_open()) {
        try {
            conn = std::make_unique<pqxx::connection>(connection_string_);
        } catch (...) {
            return std::unexpected(ErrorCode::DatabaseError);
        }
    }

    return PooledConnection(shared_from_this(), std::move(conn));
}

void ConnectionPool::release(std::unique_ptr<pqxx::connection> conn) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!shutting_down_ && conn) {
            pool_.push(std::move(conn));
        }
    }
    cv_.notify_one();
}

size_t ConnectionPool::size() const noexcept {
    return pool_size_;
}

size_t ConnectionPool::available() const noexcept {
    std::lock_guard<std::mutex> lock(mutex_);
    return pool_.size();
}

} // namespace cme::db
