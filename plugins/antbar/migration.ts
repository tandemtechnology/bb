import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type BetterSqlite3 from "better-sqlite3";

const LEGACY_PLUGIN_ID = "thread-groups";
const MIGRATION_KEY = "legacy-thread-groups-v1";

type MigrationResult =
  | { status: "already-complete" }
  | { status: "not-found" }
  | { status: "incompatible" }
  | { status: "imported"; groups: number; memberships: number };

interface DatabaseListRow {
  name: string;
  file: string;
}

function markComplete(db: BetterSqlite3.Database) {
  db.prepare(
    "INSERT OR IGNORE INTO antbar_meta (key, completed_at) VALUES (?, ?)",
  ).run(MIGRATION_KEY, Date.now());
}

function hasLegacyTables(db: BetterSqlite3.Database): boolean {
  const rows = db
    .prepare(
      `SELECT name
         FROM legacy.sqlite_master
        WHERE type = 'table' AND name IN ('groups', 'thread_group')`,
    )
    .all() as Array<{ name: string }>;
  return rows.length === 2;
}

/**
 * Imports the database owned by the former thread-groups plugin on AntBar's
 * first load. The source stays untouched so disabling AntBar is reversible.
 */
export function migrateLegacyThreadGroups(
  db: BetterSqlite3.Database,
): MigrationResult {
  db.exec(
    `CREATE TABLE IF NOT EXISTS antbar_meta (
       key          TEXT PRIMARY KEY,
       completed_at INTEGER NOT NULL
     )`,
  );

  const completed = db
    .prepare("SELECT 1 FROM antbar_meta WHERE key = ?")
    .get(MIGRATION_KEY);
  if (completed) return { status: "already-complete" };

  const databases = db.pragma("database_list") as DatabaseListRow[];
  const mainFile = databases.find((entry) => entry.name === "main")?.file;
  if (!mainFile) {
    markComplete(db);
    return { status: "not-found" };
  }

  const legacyFile = join(
    dirname(dirname(mainFile)),
    LEGACY_PLUGIN_ID,
    "data.db",
  );
  if (resolve(legacyFile) === resolve(mainFile) || !existsSync(legacyFile)) {
    markComplete(db);
    return { status: "not-found" };
  }

  db.prepare("ATTACH DATABASE ? AS legacy").run(legacyFile);
  try {
    if (!hasLegacyTables(db)) {
      markComplete(db);
      return { status: "incompatible" };
    }

    return db.transaction(() => {
      const groups = db
        .prepare(
          `INSERT OR IGNORE INTO groups
             (id, project_id, name, color, emoji, position, created_at)
           SELECT id, project_id, name, color, emoji, position, created_at
             FROM legacy.groups`,
        )
        .run().changes;
      const memberships = db
        .prepare(
          `INSERT OR IGNORE INTO thread_group (thread_id, group_id, project_id)
           SELECT legacy_membership.thread_id,
                  legacy_membership.group_id,
                  legacy_membership.project_id
             FROM legacy.thread_group AS legacy_membership
            WHERE EXISTS (
              SELECT 1 FROM groups
               WHERE groups.id = legacy_membership.group_id
            )`,
        )
        .run().changes;
      markComplete(db);
      return { status: "imported" as const, groups, memberships };
    })();
  } finally {
    db.exec("DETACH DATABASE legacy");
  }
}
