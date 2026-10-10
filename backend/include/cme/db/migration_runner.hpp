#pragma once

#include <filesystem>
#include <string>
#include <pqxx/pqxx>
#include "cme/common.hpp"

namespace cme::db {

class MigrationRunner {
public:
    static Result<int> apply_migrations(
        pqxx::connection& conn,
        const std::filesystem::path& migrations_dir
    );
};

} // namespace cme::db
