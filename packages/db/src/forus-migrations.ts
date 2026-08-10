/**
 * Fork-specific migration numbering. See docs/forus-fork-migrations.md.
 *
 * Upstream numbers migrations sequentially, so a fork taking the next number
 * collides with upstream's on every rebase — and renumbering after the fact
 * strands any database that already applied the old number, which makes the
 * server refuse to start. Reserving a range avoids the collision rather than
 * resolving it.
 *
 * 9000 is far out on purpose. Upstream adds roughly one migration a day and is
 * below 100, so this is decades of headroom, and a larger number costs nothing.
 */
export const FORK_MIGRATION_IDX_START = 9000;

/** Tag shape for a fork migration: `<idx>_forus_<name>`. */
export const FORK_MIGRATION_TAG_PATTERN = /^\d+_forus_[a-z0-9_]+$/u;
