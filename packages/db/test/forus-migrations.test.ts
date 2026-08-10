import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Enforces the fork's migration numbering convention. See
 * docs/forus-fork-migrations.md.
 *
 * Upstream numbers migrations sequentially, so a fork that takes the next number
 * collides on every rebase — and renumbering afterwards strands any database
 * that already applied the old number, which makes the server refuse to start.
 * Reserving a far-out range avoids the collision instead of resolving it.
 *
 * A convention nobody can see is a convention nobody keeps, so it is asserted
 * here rather than left to review.
 */

import {
  FORK_MIGRATION_IDX_START as FORK_IDX_START,
  FORK_MIGRATION_TAG_PATTERN as FORK_TAG_PATTERN,
} from "../src/forus-migrations.js";

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

const journalPath = join(__dirname, "../drizzle/meta/_journal.json");
const entries: JournalEntry[] = JSON.parse(
  readFileSync(journalPath, "utf8"),
).entries;

describe("forus fork migration numbering", () => {
  it("keeps every fork migration at or above the reserved index", () => {
    const misnumbered = entries.filter(
      (entry) => entry.tag.includes("_forus_") && entry.idx < FORK_IDX_START,
    );
    expect(
      misnumbered.map((entry) => entry.tag),
      `fork migrations must be numbered >= ${FORK_IDX_START}`,
    ).toEqual([]);
  });

  it("keeps the reserved range exclusively for fork migrations", () => {
    // The other direction: an upstream migration that somehow lands at 9000+
    // would silently claim the range and reintroduce collisions.
    const squatting = entries.filter(
      (entry) => entry.idx >= FORK_IDX_START && !FORK_TAG_PATTERN.test(entry.tag),
    );
    expect(
      squatting.map((entry) => entry.tag),
      `entries at or above ${FORK_IDX_START} must be tagged <idx>_forus_<name>`,
    ).toEqual([]);
  });

  it("leaves upstream room below the reserved range", () => {
    // If upstream ever approaches 9000 this fails while there is still time to
    // move the range, rather than at the moment of the first collision.
    const upstreamMax = Math.max(
      ...entries
        .filter((entry) => !entry.tag.includes("_forus_"))
        .map((entry) => entry.idx),
    );
    expect(upstreamMax).toBeLessThan(FORK_IDX_START - 500);
  });

  it("applies migrations by timestamp, so non-monotonic indexes are safe", () => {
    // Jumping to 9000 means upstream's next migration has a lower index but a
    // newer timestamp. Drizzle orders by `when`, so that must stay strictly
    // increasing even though `idx` no longer does.
    const whens = entries.map((entry) => entry.when);
    expect([...whens].sort((a, b) => a - b)).toEqual(whens);
  });
});
