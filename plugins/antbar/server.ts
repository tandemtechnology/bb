// AntBar — backend entry.
//
// Organizes a project's threads into user-defined groups (kanban-style: one
// group per thread). Groups + membership live in this plugin's own SQLite db;
// threads are read live from the bb SDK. Every mutation is exposed over both
// RPC (for the board UI) and the `bb antbar` CLI (for agents), and
// publishes a realtime signal so open boards refetch.
import {
  defineRpcContract,
  type BbPluginApi,
  type PluginCliContext,
  type PluginCliResult,
} from "@bb/plugin-sdk";
import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";
import { migrateLegacyThreadGroups } from "./migration";

// ---------------------------------------------------------------------------
// Types + schemas
// ---------------------------------------------------------------------------

const groupSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    color: z.string(),
    emoji: z.string(),
    position: z.number().int(),
    createdAt: z.number().int(),
  })
  .strict();
type Group = z.infer<typeof groupSchema>;

const threadCardSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    updatedAt: z.number().int(),
  })
  .strict();

const columnSchema = z
  .object({
    // null groupId = the synthetic "Ungrouped" column.
    groupId: z.string().nullable(),
    threads: z.array(threadCardSchema),
  })
  .strict();

const projectIdSchema = z.string().min(1);
const groupIdSchema = z.string().min(1);

export const rpcContract = defineRpcContract({
  listBoard: {
    input: z.object({ projectId: projectIdSchema }).strict(),
    output: z
      .object({ groups: z.array(groupSchema), columns: z.array(columnSchema) })
      .strict(),
  },
  createGroup: {
    input: z
      .object({
        projectId: projectIdSchema,
        name: z.string().min(1),
        color: z.string().default(""),
        emoji: z.string().default(""),
      })
      .strict(),
    output: z.object({ group: groupSchema }).strict(),
  },
  renameGroup: {
    input: z
      .object({
        groupId: groupIdSchema,
        name: z.string().min(1),
        color: z.string().default(""),
        emoji: z.string().default(""),
      })
      .strict(),
    output: z.object({ group: groupSchema }).strict(),
  },
  deleteGroup: {
    input: z.object({ groupId: groupIdSchema }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  reorderGroups: {
    input: z
      .object({
        projectId: projectIdSchema,
        orderedIds: z.array(groupIdSchema),
      })
      .strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  assignThread: {
    input: z
      .object({
        threadId: z.string().min(1),
        projectId: projectIdSchema,
        // null = unassign (thread falls back to "Ungrouped").
        groupId: groupIdSchema.nullable(),
      })
      .strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  // Used by the thread-side assign tab to render its current selection.
  threadGroup: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ groupId: z.string().nullable() }).strict(),
  },
  // Every group + membership across all projects — for the nested sidebar,
  // which shows all projects at once.
  allGroups: {
    input: z.null(),
    output: z
      .object({
        groups: z.array(groupSchema),
        membership: z.array(
          z.object({ threadId: z.string(), groupId: z.string() }).strict(),
        ),
      })
      .strict(),
  },
});

// ---------------------------------------------------------------------------
// Data-access helpers (pure over a db handle — unit-testable, no bb.* here)
// ---------------------------------------------------------------------------

interface GroupRow {
  id: string;
  project_id: string;
  name: string;
  color: string;
  emoji: string;
  position: number;
  created_at: number;
}

function rowToGroup(row: GroupRow): Group {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    color: row.color,
    emoji: row.emoji,
    position: row.position,
    createdAt: row.created_at,
  };
}

function listGroupRows(db: BetterSqlite3.Database, projectId: string): Group[] {
  const rows = db
    .prepare(
      `SELECT id, project_id, name, color, emoji, position, created_at
         FROM groups WHERE project_id = ? ORDER BY position ASC, created_at ASC`,
    )
    .all(projectId) as GroupRow[];
  return rows.map(rowToGroup);
}

function getGroupRow(
  db: BetterSqlite3.Database,
  groupId: string,
): Group | null {
  const row = db
    .prepare(
      `SELECT id, project_id, name, color, emoji, position, created_at
         FROM groups WHERE id = ?`,
    )
    .get(groupId) as GroupRow | undefined;
  return row ? rowToGroup(row) : null;
}

// thread_id -> group_id for one project, as a plain map.
function membershipForProject(
  db: BetterSqlite3.Database,
  projectId: string,
): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT thread_id, group_id FROM thread_group WHERE project_id = ?`,
    )
    .all(projectId) as { thread_id: string; group_id: string }[];
  return new Map(rows.map((r) => [r.thread_id, r.group_id]));
}

function groupForThread(
  db: BetterSqlite3.Database,
  threadId: string,
): string | null {
  const row = db
    .prepare(`SELECT group_id FROM thread_group WHERE thread_id = ?`)
    .get(threadId) as { group_id: string } | undefined;
  return row?.group_id ?? null;
}

function nextPosition(db: BetterSqlite3.Database, projectId: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(position), -1) AS maxPos FROM groups WHERE project_id = ?`,
    )
    .get(projectId) as { maxPos: number };
  return row.maxPos + 1;
}

// A short unguessable id without pulling in a uuid dep.
function makeGroupId(seed: number): string {
  const rand = Math.abs(Math.round(Math.sin(seed) * 1e9)).toString(36);
  return `grp_${seed.toString(36)}${rand}`;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("AntBar loaded");

  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS groups (
       id         TEXT PRIMARY KEY,
       project_id TEXT NOT NULL,
       name       TEXT NOT NULL,
       color      TEXT NOT NULL DEFAULT '',
       emoji      TEXT NOT NULL DEFAULT '',
       position   INTEGER NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_groups_project ON groups(project_id, position)`,
    `CREATE TABLE IF NOT EXISTS thread_group (
       thread_id  TEXT PRIMARY KEY,
       group_id   TEXT NOT NULL,
       project_id TEXT NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_thread_group_group ON thread_group(group_id)`,
  ]);

  const legacyMigration = migrateLegacyThreadGroups(db);
  if (legacyMigration.status === "imported") {
    bb.log.info(
      `Imported ${legacyMigration.groups} group(s) and ${legacyMigration.memberships} membership(s) from thread-groups`,
    );
  } else if (legacyMigration.status === "incompatible") {
    bb.log.warn(
      "Skipped thread-groups data import because its database schema is incompatible",
    );
  }

  // Monotonic-ish counter for id generation (Date.now is unavailable in some
  // harnesses; a persisted counter is deterministic and reload-safe). AntBar
  // owns a new kv namespace, so skip any IDs already imported from the legacy
  // database instead of relying on its inaccessible counter.
  let idSeed = (await bb.storage.kv.get<number>("id-seed")) ?? 0;
  async function newId(): Promise<string> {
    let candidate: string;
    do {
      idSeed += 1;
      candidate = makeGroupId(idSeed);
    } while (getGroupRow(db, candidate));
    await bb.storage.kv.set("id-seed", idSeed);
    return candidate;
  }

  function boardChanged(projectId: string) {
    bb.realtime.publish(`board:${projectId}`, { projectId });
    // Global channel for the cross-project sidebar (any project's change).
    bb.realtime.publish("antbar:groups-changed", { projectId });
  }

  // Build the columns for a project: one per group (in order) + a trailing
  // "Ungrouped" column, filled from a single live thread read.
  async function buildBoard(projectId: string) {
    const groups = listGroupRows(db, projectId);
    const membership = membershipForProject(db, projectId);
    const threads = await bb.sdk.threads.list({ projectId, limit: 500 });

    type Card = {
      id: string;
      title: string;
      status: string;
      updatedAt: number;
    };
    const buckets = new Map<string | null, Card[]>();
    for (const group of groups) buckets.set(group.id, []);
    buckets.set(null, []);

    for (const thread of threads) {
      if (thread.archivedAt !== null) continue;
      const assigned = membership.get(thread.id) ?? null;
      // A membership pointing at a deleted group falls back to Ungrouped.
      const key = assigned && buckets.has(assigned) ? assigned : null;
      buckets.get(key)!.push({
        id: thread.id,
        title: thread.title ?? thread.titleFallback ?? "Untitled thread",
        status: thread.status,
        updatedAt: thread.updatedAt,
      });
    }

    const sortCards = (cards: Card[]) =>
      cards.sort((a, b) => b.updatedAt - a.updatedAt);

    const columns: { groupId: string | null; threads: Card[] }[] = [
      ...groups.map((group) => ({
        groupId: group.id as string | null,
        threads: sortCards(buckets.get(group.id)!),
      })),
      { groupId: null, threads: sortCards(buckets.get(null)!) },
    ];
    return { groups, columns };
  }

  bb.rpc.register(rpcContract, {
    async listBoard({ projectId }) {
      return buildBoard(projectId);
    },

    async createGroup({ projectId, name, color, emoji }) {
      const id = await newId();
      const position = nextPosition(db, projectId);
      const createdAt = idSeed; // reload-safe monotonic stamp
      db.prepare(
        `INSERT INTO groups (id, project_id, name, color, emoji, position, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, projectId, name, color, emoji, position, createdAt);
      boardChanged(projectId);
      return {
        group: { id, projectId, name, color, emoji, position, createdAt },
      };
    },

    renameGroup({ groupId, name, color, emoji }) {
      const existing = getGroupRow(db, groupId);
      if (!existing) throw new Error(`Unknown group ${groupId}`);
      db.prepare(
        `UPDATE groups SET name = ?, color = ?, emoji = ? WHERE id = ?`,
      ).run(name, color, emoji, groupId);
      boardChanged(existing.projectId);
      return { group: { ...existing, name, color, emoji } };
    },

    deleteGroup({ groupId }) {
      const existing = getGroupRow(db, groupId);
      if (!existing) throw new Error(`Unknown group ${groupId}`);
      const tx = db.transaction(() => {
        db.prepare(`DELETE FROM thread_group WHERE group_id = ?`).run(groupId);
        db.prepare(`DELETE FROM groups WHERE id = ?`).run(groupId);
      });
      tx();
      boardChanged(existing.projectId);
      return { ok: true as const };
    },

    reorderGroups({ projectId, orderedIds }) {
      const tx = db.transaction(() => {
        orderedIds.forEach((id, index) => {
          db.prepare(
            `UPDATE groups SET position = ? WHERE id = ? AND project_id = ?`,
          ).run(index, id, projectId);
        });
      });
      tx();
      boardChanged(projectId);
      return { ok: true as const };
    },

    assignThread({ threadId, projectId, groupId }) {
      if (groupId === null) {
        db.prepare(`DELETE FROM thread_group WHERE thread_id = ?`).run(
          threadId,
        );
      } else {
        const group = getGroupRow(db, groupId);
        if (!group) throw new Error(`Unknown group ${groupId}`);
        // One group per thread: upsert keyed on thread_id.
        db.prepare(
          `INSERT INTO thread_group (thread_id, group_id, project_id)
             VALUES (?, ?, ?)
           ON CONFLICT(thread_id) DO UPDATE SET group_id = excluded.group_id,
                                                project_id = excluded.project_id`,
        ).run(threadId, groupId, projectId);
      }
      boardChanged(projectId);
      return { ok: true as const };
    },

    threadGroup({ threadId }) {
      return { groupId: groupForThread(db, threadId) };
    },

    allGroups() {
      const groups = (
        db
          .prepare(
            `SELECT id, project_id, name, color, emoji, position, created_at
               FROM groups ORDER BY project_id ASC, position ASC, created_at ASC`,
          )
          .all() as GroupRow[]
      ).map(rowToGroup);
      const membership = (
        db.prepare(`SELECT thread_id, group_id FROM thread_group`).all() as {
          thread_id: string;
          group_id: string;
        }[]
      ).map((r) => ({ threadId: r.thread_id, groupId: r.group_id }));
      return { groups, membership };
    },
  });

  // -------------------------------------------------------------------------
  // CLI: `bb antbar …` — the agent-facing surface, mirrors the RPCs.
  // -------------------------------------------------------------------------

  function readFlag(argv: string[], flag: string): string | undefined {
    const idx = argv.indexOf(flag);
    if (idx === -1) return undefined;
    return argv[idx + 1];
  }
  function positional(argv: string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < argv.length; i += 1) {
      const token = argv[i];
      if (token.startsWith("--")) {
        i += 1; // skip its value
        continue;
      }
      out.push(token);
    }
    return out;
  }
  async function resolveProjectId(
    argv: string[],
    ctx: PluginCliContext,
  ): Promise<string | undefined> {
    return readFlag(argv, "--project") ?? ctx.projectId;
  }

  const ROOT_HELP = [
    "bb antbar — organize a project's threads into groups",
    "",
    "  bb antbar list [--project <id>]",
    "  bb antbar create <name> [--project <id>] [--emoji <e>] [--color <token>]",
    "  bb antbar rename <groupId> <name> [--emoji <e>] [--color <token>]",
    "  bb antbar delete <groupId>",
    "  bb antbar assign <threadId> <groupId|none> [--project <id>]",
  ].join("\n");

  bb.cli.register({
    name: "antbar",
    summary: "Manage AntBar thread groups",
    commands: [
      {
        name: "list",
        summary: "List groups in a project with thread counts",
        usage: "bb antbar list [--project <id>]",
      },
      {
        name: "create",
        summary: "Create a group",
        usage:
          "bb antbar create <name> [--project <id>] [--emoji <e>] [--color <token>]",
      },
      {
        name: "rename",
        summary: "Rename a group (and optionally set emoji/color)",
        usage:
          "bb antbar rename <groupId> <name> [--emoji <e>] [--color <token>]",
      },
      {
        name: "delete",
        summary: "Delete a group (its threads fall back to Ungrouped)",
        usage: "bb antbar delete <groupId>",
      },
      {
        name: "assign",
        summary: "Assign a thread to a group, or 'none' to unassign",
        usage: "bb antbar assign <threadId> <groupId|none> [--project <id>]",
      },
    ],
    async run(argv, ctx): Promise<PluginCliResult> {
      const [command, ...rest] = argv;
      if (!command || command === "help" || command === "--help") {
        return { exitCode: 0, stdout: ROOT_HELP };
      }

      try {
        switch (command) {
          case "list": {
            const projectId = await resolveProjectId(rest, ctx);
            if (!projectId) {
              return {
                exitCode: 1,
                stderr:
                  "No project. Pass --project <id> or run inside a project thread.",
              };
            }
            const { groups, columns } = await buildBoard(projectId);
            if (groups.length === 0) {
              return {
                exitCode: 0,
                stdout: `No groups in ${projectId}. Create one with: bb antbar create <name> --project ${projectId}`,
              };
            }
            const counts = new Map(
              columns.map((c) => [c.groupId, c.threads.length]),
            );
            const lines = groups.map((g) => {
              const label = `${g.emoji ? g.emoji + " " : ""}${g.name}`;
              return `${g.id}  ${label}  (${counts.get(g.id) ?? 0} threads)`;
            });
            const ungrouped =
              columns.find((c) => c.groupId === null)?.threads.length ?? 0;
            lines.push(`(ungrouped)  ${ungrouped} threads`);
            return { exitCode: 0, stdout: lines.join("\n") };
          }

          case "create": {
            const projectId = await resolveProjectId(rest, ctx);
            const [name] = positional(rest);
            if (!projectId) {
              return {
                exitCode: 1,
                stderr:
                  "No project. Pass --project <id> or run inside a project thread.",
              };
            }
            if (!name) {
              return { exitCode: 1, stderr: "Usage: bb antbar create <name>" };
            }
            const id = await newId();
            const position = nextPosition(db, projectId);
            const emoji = readFlag(rest, "--emoji") ?? "";
            const color = readFlag(rest, "--color") ?? "";
            db.prepare(
              `INSERT INTO groups (id, project_id, name, color, emoji, position, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ).run(id, projectId, name, color, emoji, position, idSeed);
            boardChanged(projectId);
            return { exitCode: 0, stdout: `Created group ${id} (${name})` };
          }

          case "rename": {
            const [groupId, name] = positional(rest);
            if (!groupId || !name) {
              return {
                exitCode: 1,
                stderr: "Usage: bb antbar rename <groupId> <name>",
              };
            }
            const existing = getGroupRow(db, groupId);
            if (!existing) {
              return { exitCode: 1, stderr: `Unknown group ${groupId}` };
            }
            const emoji = readFlag(rest, "--emoji") ?? existing.emoji;
            const color = readFlag(rest, "--color") ?? existing.color;
            db.prepare(
              `UPDATE groups SET name = ?, color = ?, emoji = ? WHERE id = ?`,
            ).run(name, color, emoji, groupId);
            boardChanged(existing.projectId);
            return { exitCode: 0, stdout: `Renamed ${groupId} to ${name}` };
          }

          case "delete": {
            const [groupId] = positional(rest);
            if (!groupId) {
              return {
                exitCode: 1,
                stderr: "Usage: bb antbar delete <groupId>",
              };
            }
            const existing = getGroupRow(db, groupId);
            if (!existing) {
              return { exitCode: 1, stderr: `Unknown group ${groupId}` };
            }
            const tx = db.transaction(() => {
              db.prepare(`DELETE FROM thread_group WHERE group_id = ?`).run(
                groupId,
              );
              db.prepare(`DELETE FROM groups WHERE id = ?`).run(groupId);
            });
            tx();
            boardChanged(existing.projectId);
            return { exitCode: 0, stdout: `Deleted group ${groupId}` };
          }

          case "assign": {
            const [threadId, groupArg] = positional(rest);
            if (!threadId || !groupArg) {
              return {
                exitCode: 1,
                stderr: "Usage: bb antbar assign <threadId> <groupId|none>",
              };
            }
            if (groupArg === "none") {
              const projectId =
                (await resolveProjectId(rest, ctx)) ??
                (
                  await bb.sdk.threads
                    .get({ threadId })
                    .catch(() => null as { projectId?: string } | null)
                )?.projectId;
              db.prepare(`DELETE FROM thread_group WHERE thread_id = ?`).run(
                threadId,
              );
              if (projectId) boardChanged(projectId);
              return { exitCode: 0, stdout: `Unassigned ${threadId}` };
            }
            const group = getGroupRow(db, groupArg);
            if (!group) {
              return { exitCode: 1, stderr: `Unknown group ${groupArg}` };
            }
            db.prepare(
              `INSERT INTO thread_group (thread_id, group_id, project_id)
                 VALUES (?, ?, ?)
               ON CONFLICT(thread_id) DO UPDATE SET group_id = excluded.group_id,
                                                    project_id = excluded.project_id`,
            ).run(threadId, groupArg, group.projectId);
            boardChanged(group.projectId);
            return {
              exitCode: 0,
              stdout: `Assigned ${threadId} to ${group.name} (${groupArg})`,
            };
          }

          default:
            return {
              exitCode: 1,
              stderr: `Unknown command '${command}'.\n\n${ROOT_HELP}`,
            };
        }
      } catch (error) {
        return {
          exitCode: 1,
          stderr: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  bb.onDispose(() => {
    bb.log.info("AntBar disposed");
  });
}
