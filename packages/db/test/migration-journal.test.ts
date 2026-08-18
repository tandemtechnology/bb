import fs from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FORK_MIGRATION_IDX_START } from "../src/forus-migrations.js";
import {
  publishedMigrationWhens,
  publishedMigrationWhensByTag,
} from "../src/migration-history.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const journalPath = resolve(
  __dirname,
  "..",
  "drizzle",
  "meta",
  "_journal.json",
);
const latestPublishedMigrationWhen = Math.max(
  ...publishedMigrationWhens.map((entry) => entry.when),
);

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

function readJournal(): Journal {
  return JSON.parse(fs.readFileSync(journalPath, "utf-8")) as Journal;
}

interface MigrationSnapshot {
  id: string;
  prevId: string;
}

function snapshotPathFor(idx: number): string {
  return resolve(
    __dirname,
    "..",
    "drizzle",
    "meta",
    `${String(idx).padStart(4, "0")}_snapshot.json`,
  );
}

function readSnapshot(idx: number): MigrationSnapshot {
  return JSON.parse(
    fs.readFileSync(snapshotPathFor(idx), "utf-8"),
  ) as MigrationSnapshot;
}

describe("migration journal integrity", () => {
  it("has strictly increasing `when` timestamps", () => {
    const { entries } = readJournal();

    const violations: string[] = [];
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].when <= entries[i - 1].when) {
        violations.push(
          `entries[${i}] ${entries[i].tag} (when=${entries[i].when}) <= ` +
            `entries[${i - 1}] ${entries[i - 1].tag} (when=${entries[i - 1].when})`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  // FORK DIVERGENCE: upstream asserts idx === array position for every entry.
  //
  // This fork reserves indexes at or above 9000 for its own migrations so they
  // never collide with upstream's next sequential number — see
  // docs/forus-fork-migrations.md. That block is deliberately discontiguous, so
  // the position check now applies to upstream entries only.
  //
  // The invariant keeps its real job, catching an upstream migration that was
  // accidentally renumbered. Nothing in production code reads `idx`: drizzle
  // loads `<tag>.sql` and orders by `when`, so the fork block is inert beyond
  // telling drizzle-kit where to continue numbering.
  it("has `idx` values matching array position for upstream migrations", () => {
    const { entries } = readJournal();
    const upstreamEntries = entries.filter(
      (entry) => entry.idx < FORK_MIGRATION_IDX_START,
    );
    const mismatches: string[] = [];
    for (let i = 0; i < upstreamEntries.length; i++) {
      const entry = upstreamEntries[i];
      if (entry.idx !== i) {
        mismatches.push(
          `entries[${i}] ${entry.tag} has idx=${entry.idx}, expected ${i}`,
        );
      }
    }

    expect(mismatches).toEqual([]);
  });

  it("keeps fork migrations in timestamp order with upstream migrations", () => {
    // A fork migration keeps its reserved idx but must remain in timestamp
    // order. Drizzle walks the journal and skips entries older than the latest
    // applied timestamp, so moving a fork entry to the end would strand it on a
    // fresh database once newer upstream entries exist.
    const { entries } = readJournal();
    expect(entries.map((entry) => entry.when)).toEqual(
      entries.map((entry) => entry.when).sort((a, b) => a - b),
    );
  });

  it("has a matching .sql file for every journal entry", () => {
    const { entries } = readJournal();
    const drizzleDir = resolve(__dirname, "..", "drizzle");

    const missing: string[] = [];
    for (const entry of entries) {
      const sqlPath = resolve(drizzleDir, `${entry.tag}.sql`);
      if (!fs.existsSync(sqlPath)) {
        missing.push(entry.tag);
      }
    }

    expect(missing).toEqual([]);
  });

  it("contains every published migration with its released timestamp", () => {
    const { entries } = readJournal();
    const entriesByTag = new Map(entries.map((entry) => [entry.tag, entry]));

    const violations: string[] = [];
    for (const publishedMigration of publishedMigrationWhens) {
      const entry = entriesByTag.get(publishedMigration.tag);
      if (entry === undefined) {
        violations.push(`${publishedMigration.tag} is missing from journal`);
        continue;
      }

      if (entry.when !== publishedMigration.when) {
        violations.push(
          `${entry.tag} has when=${entry.when}, expected published when=${publishedMigration.when}`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps new migrations after the published migration history", () => {
    const { entries } = readJournal();

    const violations = entries
      .filter((entry) => !publishedMigrationWhensByTag.has(entry.tag))
      .filter((entry) => entry.when <= latestPublishedMigrationWhen)
      .map(
        (entry) =>
          `${entry.tag} has when=${entry.when}, expected > ${latestPublishedMigrationWhen}`,
      );

    expect(violations).toEqual([]);
  });

  // Regression guard: a migration that is hand-authored and added to the
  // journal without running `drizzle-kit generate` has no meta snapshot. The
  // snapshot chain then silently goes stale, and the next `drizzle-kit
  // generate` diffs against the wrong base and emits a corrupt migration.
  // Every journal entry must carry its generated snapshot.
  it("has a matching snapshot file for every journal entry", () => {
    const { entries } = readJournal();

    const missing = entries
      .filter((entry) => !fs.existsSync(snapshotPathFor(entry.idx)))
      .map((entry) => entry.tag);

    expect(missing).toEqual([]);
  });

  it("has valid upstream and fork snapshot ancestry", () => {
    const entries = readJournal().entries;
    const upstreamEntries = entries.filter(
      (entry) => entry.idx < FORK_MIGRATION_IDX_START,
    );

    const violations: string[] = [];
    let previousSnapshotId: string | null = null;
    for (const entry of upstreamEntries) {
      const snapshot = readSnapshot(entry.idx);
      if (previousSnapshotId !== null && snapshot.prevId !== previousSnapshotId) {
        violations.push(
          `${entry.tag} snapshot prevId=${snapshot.prevId}, expected ${previousSnapshotId}`,
        );
      }
      previousSnapshotId = snapshot.id;
    }

    const snapshotsById = new Map(
      entries.map((entry) => {
        const snapshot = readSnapshot(entry.idx);
        return [snapshot.id, { entry, snapshot }] as const;
      }),
    );
    for (const entry of entries.filter(
      (candidate) => candidate.idx >= FORK_MIGRATION_IDX_START,
    )) {
      const snapshot = readSnapshot(entry.idx);
      const parent = snapshotsById.get(snapshot.prevId);
      if (parent === undefined || parent.entry.when >= entry.when) {
        violations.push(
          `${entry.tag} snapshot prevId=${snapshot.prevId} is not an earlier journal snapshot`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
