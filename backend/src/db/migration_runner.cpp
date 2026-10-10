#include "cme/db/migration_runner.hpp"
#include <fstream>
#include <iostream>
#include <regex>
#include <vector>
#include <algorithm>

namespace cme::db {

Result<int> MigrationRunner::apply_migrations(
    pqxx::connection& conn,
    const std::filesystem::path& migrations_dir
) {
    if (!std::filesystem::exists(migrations_dir) || !std::filesystem::is_directory(migrations_dir)) {
        std::cerr << "[ERROR] Migrations directory does not exist: " << migrations_dir << "\n";
        return std::unexpected(ErrorCode::NotFound);
    }

    try {
        // 1. Ensure schema_migrations table exists
        {
            pqxx::work tx(conn);
            tx.exec(R"(
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INT PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
            )");
            tx.commit();
        }

        // 2. Collect and sort all migration .sql files
        std::vector<std::filesystem::path> migration_files;
        for (const auto& entry : std::filesystem::directory_iterator(migrations_dir)) {
            if (entry.is_regular_file() && entry.path().extension() == ".sql") {
                migration_files.push_back(entry.path());
            }
        }

        std::sort(migration_files.begin(), migration_files.end());

        int applied_count = 0;
        const std::regex prefix_regex(R"(^(\d+)[-_](.*)\.sql$)");

        for (const auto& file_path : migration_files) {
            std::string filename = file_path.filename().string();
            std::smatch match;
            if (!std::regex_match(filename, match, prefix_regex)) {
                std::cout << "[WARN] Skipping migration file not matching pattern: " << filename << "\n";
                continue;
            }

            int version = std::stoi(match[1].str());
            std::string migration_name = match[2].str();

            // Check if already applied
            {
                pqxx::work tx(conn);
                auto res = tx.exec_params(
                    "SELECT 1 FROM schema_migrations WHERE version = $1",
                    version
                );
                if (!res.empty()) {
                    // Already applied
                    continue;
                }
            }

            // Read SQL content
            std::ifstream file(file_path);
            if (!file) {
                std::cerr << "[ERROR] Unable to read migration file: " << file_path << "\n";
                return std::unexpected(ErrorCode::IoError);
            }
            std::string sql((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());

            // Execute migration in transaction
            std::cout << "[MIGRATE] Applying migration " << version << " (" << filename << ")..." << std::endl;
            pqxx::work tx(conn);
            tx.exec(sql);
            tx.exec_params(
                "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
                version, filename
            );
            tx.commit();

            std::cout << "[MIGRATE] Successfully applied " << filename << std::endl;
            applied_count++;
        }

        return applied_count;
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] Migration failure: " << e.what() << "\n";
        return std::unexpected(ErrorCode::DatabaseError);
    }
}

} // namespace cme::db
