<!-- Diátaxis: reference -->

# Forus fork: database migrations

This file is specific to the Forus fork of bb and has no upstream counterpart.
It is a separate file rather than a section of `AGENTS.md` or `README.md` so it
never conflicts when merging upstream.

## The problem

Upstream numbers migrations sequentially: `0088_narrow_kronos`,
`0089_chemical_darwin`. A fork that adds a migration takes the next number too,
so both sides claim the same index and the `_journal.json` merge fails. It has
happened on every rebase so far.

Renumbering afterwards is worse than it sounds. Drizzle only applies migrations
whose journal timestamp is newer than the latest applied one, so a database that
already ran the old number silently skips the upstream migration that took its
place, and bb's own history validation then refuses to start:

```
Database migration history is incomplete after migration.
Missing applied migration timestamps: 0087_brief_khan
```

Recovering means deleting ledger rows by hand. Avoiding the collision entirely
is much cheaper than resolving it.

## The convention

**Fork migrations start at index 9000 and carry a `forus_` tag prefix.**

```
9000_forus_project_env_vars.sql
9001_forus_<next_thing>.sql
```

Upstream is adding roughly 0.9 migrations/day and sits below 100, so 9000 is
about 27 years of headroom. The number costs nothing, so it is deliberately far
out rather than merely far enough.

The `forus_` prefix is what makes a journal conflict obvious: seeing
`0091_upstream_thing` against `9000_forus_project_env_vars` tells you
immediately that both entries are wanted and the resolution is to keep both.

This is self-sustaining. `drizzle-kit generate` numbers from the highest index
in the journal, so once the fork is at 9000 every subsequent fork migration
lands at 9001, 9002, … automatically. Rename the generated file and its tag to
add the `forus_` prefix; nothing else is required.

Nothing parses the number. Drizzle reads `meta/_journal.json` and loads
`<tag>.sql` verbatim, and application order comes from each entry's `when`
timestamp, not its index — so a journal whose indexes are not monotonic
(upstream 0091 after our 9000) is fine.

## Writing one

1. Change `packages/db/src/schema.ts`.
2. `cd packages/db && pnpm run db:generate` — never hand-edit the snapshot JSON.
3. Rename the generated `.sql` and its `meta/*_snapshot.json` to the `forus_`
   name, and update the `tag` in `_journal.json` to match.
4. Make it **replay-safe** where the statement allows it — `CREATE TABLE IF NOT
   EXISTS`, `CREATE INDEX IF NOT EXISTS`. The migrate tests rewind the ledger to
   0085 and replay the tail, so a plain `CREATE TABLE` in a newer migration
   fails with "table already exists". Upstream's `0086` does the same thing for
   the same reason. Statements that cannot express it (SQLite `ALTER TABLE ADD
   COLUMN`) are fine as-is; they simply must run exactly once.
5. `pnpm exec turbo run test --filter=@bb/db` — the convention itself is
   enforced by `packages/db/test/forus-migrations.test.ts`.
