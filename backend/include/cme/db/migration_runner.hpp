/**
 * @file migration_runner.hpp
 * @brief Transactional executor for versioned SQL database migrations.
 */

#pragma once

#include <filesystem>
#include <string>
#include <pqxx/pqxx>
#include "cme/common.hpp"

namespace cme::db {

/**
 * @class MigrationRunner
 * @brief Discovers and executes pending .sql migrations against PostgreSQL.
 */
class MigrationRunner {
public:
    /**
     * @brief Reads versioned SQL files from migrations_dir, checks schema_migrations,
     * and executes unapplied scripts inside dedicated transactions.
     * 
     * @param conn Open PostgreSQL connection with DDL permissions.
     * @param migrations_dir Filesystem path to the directory containing *.sql files.
     * @return Result<int> Count of newly applied migrations, or ErrorCode on failure.
     */
    static Result<int> apply_migrations(
        pqxx::connection& conn,
        const std::filesystem::path& migrations_dir
    );
};

} // namespace cme::db
