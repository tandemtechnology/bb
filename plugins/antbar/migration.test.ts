import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { migrateLegacyThreadGroups } from "./migration.ts";

function createGroupSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE groups (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '',
      emoji TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE thread_group (
      thread_id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      project_id TEXT NOT NULL
    );
  `);
}

test("imports legacy groups and memberships once without changing the source", () => {
  const root = mkdtempSync(join(tmpdir(), "antbar-migration-"));
  try {
    const pluginsDir = join(root, "plugins");
    const legacyDir = join(pluginsDir, "thread-groups");
    const antbarDir = join(pluginsDir, "antbar");
    mkdirSync(legacyDir, { recursive: true });
    mkdirSync(antbarDir, { recursive: true });

    const legacy = new Database(join(legacyDir, "data.db"));
    createGroupSchema(legacy);
    legacy
      .prepare(
        `INSERT INTO groups
           (id, project_id, name, color, emoji, position, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("grp_legacy", "proj_1", "Needs review", "blue", "👀", 0, 100);
    legacy
      .prepare(
        `INSERT INTO thread_group (thread_id, group_id, project_id)
         VALUES (?, ?, ?)`,
      )
      .run("thr_1", "grp_legacy", "proj_1");
    legacy.close();

    const antbar = new Database(join(antbarDir, "data.db"));
    createGroupSchema(antbar);

    assert.deepEqual(migrateLegacyThreadGroups(antbar), {
      status: "imported",
      groups: 1,
      memberships: 1,
    });
    assert.deepEqual(migrateLegacyThreadGroups(antbar), {
      status: "already-complete",
    });
    const importedGroup = antbar
      .prepare("SELECT name FROM groups WHERE id = ?")
      .get("grp_legacy") as { name: string } | undefined;
    assert.equal(importedGroup?.name, "Needs review");
    const importedMembership = antbar
      .prepare("SELECT group_id FROM thread_group WHERE thread_id = ?")
      .get("thr_1") as { group_id: string } | undefined;
    assert.equal(importedMembership?.group_id, "grp_legacy");
    antbar.close();

    const source = new Database(join(legacyDir, "data.db"), {
      readonly: true,
    });
    const sourceCount = source
      .prepare("SELECT COUNT(*) AS count FROM groups")
      .get() as { count: number };
    assert.equal(sourceCount.count, 1);
    source.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("records a missing legacy database so deleted groups are not restored later", () => {
  const root = mkdtempSync(join(tmpdir(), "antbar-migration-"));
  try {
    const antbarDir = join(root, "plugins", "antbar");
    mkdirSync(antbarDir, { recursive: true });
    const antbar = new Database(join(antbarDir, "data.db"));
    createGroupSchema(antbar);

    assert.deepEqual(migrateLegacyThreadGroups(antbar), {
      status: "not-found",
    });
    assert.deepEqual(migrateLegacyThreadGroups(antbar), {
      status: "already-complete",
    });
    antbar.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
