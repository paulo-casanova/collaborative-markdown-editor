# Database Migrations Guide

CME manages relational schema evolution through versioned, idempotent SQL migration scripts executed by `cme::db::MigrationRunner` and the `cme-migrate` CLI utility.

## Migration File Structure

Migrations reside in the `migrations/` directory at the repository root:

```
migrations/
├── 001_initial_schema.sql
├── 002_add_feature_x.sql    # Future migration
└── 003_add_index_y.sql      # Future migration
```

### Naming Convention
* Filenames must match the regex `^(\d+)[-_](.*)\.sql$`:
  * Leading digits (e.g. `001`) indicate the strictly increasing version number.
  * Underscore or hyphen delimiter.
  * Human-readable migration description (e.g. `initial_schema`).
  * `.sql` extension.

---

## Migration Runner Lifecycle

When `cme::db::MigrationRunner::apply_migrations()` executes:

1. **Bootstrap Tracking Table:** Automatically creates `schema_migrations` if it does not exist:
   ```sql
   CREATE TABLE IF NOT EXISTS schema_migrations (
       version INT PRIMARY KEY,
       name VARCHAR(255) NOT NULL,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   ```
2. **File Discovery & Sorting:** Scans `migrations/`, parses version integers, and sorts files numerically in ascending order.
3. **Idempotency Check:** Checks `schema_migrations` for existing entries matching `version = $1`. If present, the migration is skipped.
4. **Transactional Execution:** Reads the `.sql` script and executes the entire file within an ACID transaction (`pqxx::work`).
5. **Record & Commit:** Appends `INSERT INTO schema_migrations (version, name) VALUES (version, name)` and commits the transaction. If any statement fails, the transaction rolls back cleanly.

---

## Running Migrations

### Using the `cme-migrate` CLI
```bash
# Run migrations using default or environment variable CME_DATABASE_URL
./build/bin/cme-migrate

# Point to an explicit database connection URI and custom migrations folder
./build/bin/cme-migrate \
  --db "postgresql://cme:secret@localhost:5432/cme_prod" \
  --migrations-dir ./migrations
```

### Automated Migration in CI / Tests
The test suite (`tests/backend/db_permissions_dag_test.cpp`) automatically invokes `MigrationRunner::apply_migrations()` on test startup, ensuring test databases are always migrated to the latest schema before test execution.

---

## Authoring New Migrations

1. Identify the next sequential version number (`002`, `003`, etc.).
2. Create `migrations/<version>_<description>.sql`.
3. Ensure all table and column names use lowercase identifiers (`users`, `team_parents`, `access_level`).
4. Write idempotent DDL statements (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).
5. Test your migration:
   ```bash
   ./build/bin/cme-migrate --db "postgresql://cme:secret@localhost:5432/cme_test"
   ctest --test-dir build --output-on-failure
   ```
