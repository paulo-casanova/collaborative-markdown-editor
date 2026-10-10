#include "cme/db/migration_runner.hpp"
#include "cme/version.hpp"
#include <iostream>
#include <string>
#include <cstdlib>

int main(int argc, char* argv[]) {
    std::string db_url = "postgresql://cme:secret@localhost:5432/cme_test";
    if (const char* env_db = std::getenv("CME_DATABASE_URL")) {
        db_url = env_db;
    }

    std::string migrations_dir = "migrations";

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--db" && i + 1 < argc) {
            db_url = argv[++i];
        } else if (arg == "--migrations-dir" && i + 1 < argc) {
            migrations_dir = argv[++i];
        } else if (arg == "--help" || arg == "-h") {
            std::cout << "Usage: cme-migrate [--db <connstring>] [--migrations-dir <path>]\n";
            return 0;
        }
    }

    std::cout << cme::format_version_banner() << " - Schema Migration Runner\n";
    std::cout << "[INFO] Target database: " << db_url << "\n";
    std::cout << "[INFO] Migrations directory: " << migrations_dir << "\n";

    try {
        pqxx::connection conn(db_url);
        if (!conn.is_open()) {
            std::cerr << "[ERROR] Could not open database connection.\n";
            return 1;
        }

        auto result = cme::db::MigrationRunner::apply_migrations(conn, migrations_dir);
        if (!result.has_value()) {
            std::cerr << "[ERROR] Migration failed with error: " << cme::to_string(result.error()) << "\n";
            return 1;
        }

        std::cout << "[SUCCESS] Applied " << *result << " new migration(s).\n";
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "[FATAL] Migration error: " << e.what() << "\n";
        return 1;
    }
}
