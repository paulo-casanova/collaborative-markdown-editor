# Storage Layout & Document Bundles Specification

The CME Storage Abstraction Layer (SAL) organizes document workspaces on the filesystem into four top-level directory subsystems beneath the configured storage root:

```
/var/lib/cme/storage/
├── content/              # Active document workspace
│   ├── notes.md          # Standalone document
│   ├── engineering/      # Hierarchical directories
│   │   ├── spec.md
│   │   └── project-alpha.bundle/  # Document Bundle
│   │       ├── index.md           # Primary bundle markdown
│   │       └── images/            # Co-located media assets
│   │           └── arch.png
├── trash/                # Soft-deleted nodes
│   ├── 2026-10-10-23-15-21_archive_guides_intro.md
│   └── 2026-10-10-23-15-21_archive_guides_intro.md.meta  # Sidecar metadata
├── snapshots/            # Immutable historical revisions
│   └── 2026/10/          # Date-partitioned snapshots
└── backups/              # Scheduled system archives
    ├── daily/
    └── weekly/
```

---

## 1. Active Content Subsystem (`content/`)

The `content/` directory contains all live markdown documents and media assets exposed to collaborators and web readers.

### Standalone Files vs. Document Bundles
Documents exist in two distinct formats:

1. **Standalone Files:**
   * A single standard UTF-8 `.md` file (e.g., `content/guides/intro.md`).
   * Media assets referenced via markdown syntax can be placed in a neighboring directory (e.g. `images/diagram.png`).

2. **Document Bundles:**
   * A cohesive folder encapsulating a document alongside its dedicated media assets:
     * Directory ending with `.bundle` (e.g., `project-alpha.bundle/`).
     * Directory containing an `index.md` file.
     * Directory containing a markdown file matching the directory name (e.g., `project-alpha/project-alpha.md`).
   * Moving or renaming a bundle moves all co-located images and sub-assets atomically.

---

## 2. Trash Subsystem (`trash/`)

When a user or automation agent deletes a document or directory, CME avoids destructive immediate unlinking. Instead, `delete_to_trash()` moves the item to the `trash/` directory.

### Naming & Metadata Sidecars
* **Trash Entry ID:** Formatted as `<timestamp>_<sanitized_relative_path>` (e.g. `2026-10-10-23-15-21_engineering_spec.md`).
* **Metadata Sidecar:** Stored alongside the entry as `<trash_entry_id>.meta`:
  ```ini
  original_path=engineering/spec.md
  deleted_at=2026-10-10-23-15-21
  ```
* **Restore:** `restore_from_trash(trash_id, restore_path)` moves the node back into `content/` and deletes the `.meta` file.
* **Purge:** `purge_from_trash(trash_id)` permanently removes the node and its sidecar from disk.

---

## 3. Snapshots Subsystem (`snapshots/`)

To prevent filesystem directory inode exhaustion, historical revisions are partitioned chronologically by Year (`YYYY/`) and Month (`MM/`):
* Captured automatically by the background debounced persistence loop or upon manual checkpoint tags.
* Contains full-text snapshots stamped with UTC timestamps.
