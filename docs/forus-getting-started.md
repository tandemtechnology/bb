<!-- Diátaxis: tutorial -->

# Forus bb: running from source

This is the Forus fork of [bb](https://github.com/get-bb/bb). It has no packaged
release, so you run it from a source checkout. Everything below has been run
end to end on a clean checkout; if a step fails, it is a bug in this document.

This file is fork-specific and has no upstream counterpart, so it never
conflicts when merging upstream.

## What this fork changes

Four things, all in `main`:

- **Fable threads run on their own Claude account.** Fable is entitled only on a
  1P Console org that is BAA-covered but not zero-retention, so selecting a Fable
  model switches `CLAUDE_CONFIG_DIR` and strips the credential variables that
  would otherwise override the login. See
  [configuration](./configuration.md#claude-account-binding).
- **Project-scoped environment variables** — `bb project env set/list/unset`,
  with secret values kept out of the database.
- **Telemetry is off by default** (upstream defaults it on).
- **Migrations are numbered from 9000** — see
  [fork migrations](./forus-fork-migrations.md).

## Prerequisites

- **Node.js 22.19 or newer.** 20 will not work; bb's floor is 22.19.
- **pnpm 9.15.0**, most easily via corepack:
  ```bash
  corepack enable && corepack prepare pnpm@9.15.0 --activate
  ```
- **git**, and access to the `tandemtechnology/bb` repository.

## Run it

```bash
git clone git@github.com:tandemtechnology/bb.git
cd bb
pnpm install
pnpm build
pnpm start
```

`pnpm start` prints the URL it is listening on — by default
`http://127.0.0.1:38886`. Open that in a browser. There is no desktop app on
this path; the UI is the same web app the desktop app wraps.

## If you already have bb installed

`pnpm start` uses the same data directory (`~/.bb`) and the same port (38886) as
the released app, so the two collide. Either quit the installed app first, or
give the source build its own:

```bash
BB_DATA_DIR=~/.bb-forus BB_SERVER_PORT=38900 BB_HOST_DAEMON_PORT=38901 pnpm start
```

A separate data directory means separate projects, threads, and provider logins.

## Working on bb itself

```bash
pnpm dev
```

This runs Vite with hot reload against a separate dev server, on ports derived
from a hash of the checkout path (so two checkouts never collide), with data
under `~/.bb-dev/<checkout>/`. Telemetry never runs in development regardless of
configuration.

Before pushing:

```bash
pnpm exec turbo run typecheck
pnpm exec turbo run test --filter=@bb/<package>
```

## Things that will bite you

- **Do not copy `node_modules` between machines.** `better-sqlite3` and
  `@parcel/watcher` are native add-ons; they must be built on the machine that
  runs them, and on the right OS and libc. Run `pnpm install` locally instead.
  The same applies between a macOS host and a Linux container.
- **Providers authenticate separately.** A source build uses whatever Claude
  Code or Codex login exists on the machine. If you use Fable, log into that
  account once in its own config directory — see
  [Claude account binding](./configuration.md#claude-account-binding).
- **Updating means `git pull`.** There is no auto-update on this path. The
  desktop auto-updater in `apps/desktop` still points at the upstream release
  feed, so a packaged build of this fork would update itself to upstream and
  silently discard these changes. That must be repointed before anyone packages
  this; it does not affect running from source.
- **The `main` branch tracks upstream plus the four changes above.** Rebasing
  onto upstream conflicts predictably on `HOST_DAEMON_PROTOCOL_VERSION` and the
  migration journal; see [fork migrations](./forus-fork-migrations.md).
