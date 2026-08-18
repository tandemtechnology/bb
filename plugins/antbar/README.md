# AntBar

AntBar is one BB sidebar provider with an attention Inbox first, followed by
Project → Group → Thread organization. It also includes the Groups board and
the `bb antbar` command for agents.

A thread appears in Inbox when it is unread or BB reports
`hasPendingInteraction`. Inbox entries are lightweight shortcuts that open the
session. Every session remains in its normal project and group, where its full
row and controls live.

Use a grouped thread row's actions menu to set its title manually or regenerate
it from the thread's initial prompt.

Group create/edit dialogs include a picker for choosing or clearing an emoji.

## Install and select

From the repository root:

```sh
bb plugin install ./plugins/antbar
```

Then choose **AntBar** under **Settings → Appearance → Sidebar**. After source
edits:

```sh
bb plugin reload antbar
```

The first AntBar load checks for
`<dataDir>/plugins/thread-groups/data.db`. If present, it copies legacy groups
and memberships once into AntBar's database. The source database is never
modified or deleted, so rollback remains possible. After confirming the import,
disable the old plugin to avoid exposing two sidebar providers:

```sh
bb plugin disable thread-groups
```

## Customize the starter

The most useful extension points are:

- `inbox.ts` — change the attention policy, filtering, or Inbox ordering.
- `app.tsx` → `AntBarSidebar` — change the Inbox presentation and the
  Project → Group → Thread hierarchy.
- `app.tsx` → `SidebarRow` — adjust row metadata and actions.
- `app.tsx` → `Board` — customize the optional kanban view.
- `server.ts` — add RPC and `bb antbar` operations for durable group data.
- `migration.ts` — the one-time, non-destructive legacy database import.

Use BB theme tokens in UI classes so AntBar follows custom palettes. Because
`experimental_threadList` is an exclusive slot, AntBar must be selected as the
active sidebar provider; it cannot render alongside another thread-list plugin.

## Agent-facing group commands

```sh
bb antbar list --project <projectId>
bb antbar create "Needs review" --project <projectId> --emoji "👀"
bb antbar assign <threadId> <groupId>
bb antbar assign <threadId> none
```

## Verify changes

Use the repository's Turbo tasks:

```sh
pnpm exec turbo run test --filter=bb-plugin-antbar
pnpm exec turbo run typecheck --filter=bb-plugin-antbar
pnpm exec turbo run build --filter=bb-plugin-antbar
```

The build writes the server and app bundles under `dist/`. The vendored
`components/ui/` sources are owned by this plugin and can be edited directly.
