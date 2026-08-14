import assert from "node:assert/strict";
import test from "node:test";
import type { PluginSidebarThread } from "@bb/plugin-sdk";
import { projectInbox, sortThreads, threadTitle } from "./inbox.ts";

function thread(
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id: "thr_1",
    projectId: "proj_1",
    title: "A thread",
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    isArchived: false,
    environment: null,
    host: null,
    createdAt: 1,
    updatedAt: 1,
    lastReadAt: 1,
    latestAttentionAt: 1,
    ...overrides,
  };
}

test("adds pending interactions to Inbox while retaining grouped rows", () => {
  const waiting = thread({
    id: "waiting",
    hasPendingInteraction: true,
    indicator: "waiting-for-input",
  });
  const ordinary = thread({ id: "ordinary" });
  const result = projectInbox([ordinary, waiting], "");

  assert.deepEqual(
    result.inbox.map(({ id }) => id),
    ["waiting"],
  );
  assert.deepEqual(
    result.grouped.map(({ id }) => id),
    ["ordinary", "waiting"],
  );
});

test("adds unread threads to Inbox while retaining grouped rows", () => {
  const unread = thread({
    id: "unread",
    isUnread: true,
    indicator: "unread-success",
  });
  const ordinary = thread({ id: "ordinary" });
  const result = projectInbox([ordinary, unread], "");

  assert.deepEqual(
    result.inbox.map(({ id }) => id),
    ["unread"],
  );
  assert.deepEqual(
    result.grouped.map(({ id }) => id),
    ["ordinary", "unread"],
  );
});

test("orders attention by recency", () => {
  const result = projectInbox(
    [
      thread({
        id: "old-question",
        hasPendingInteraction: true,
        latestAttentionAt: 10,
      }),
      thread({
        id: "new-question",
        hasPendingInteraction: true,
        latestAttentionAt: 20,
      }),
    ],
    "",
  );

  assert.deepEqual(
    result.inbox.map(({ id }) => id),
    ["new-question", "old-question"],
  );
});

test("promotes pending input even when an unread error owns the glyph", () => {
  const result = projectInbox(
    [
      thread({
        id: "overlap",
        indicator: "unread-error",
        hasPendingInteraction: true,
        isUnread: true,
      }),
    ],
    "",
  );

  assert.deepEqual(
    result.inbox.map(({ id }) => id),
    ["overlap"],
  );
});

test("searches the visible title and excludes archived threads", () => {
  const result = projectInbox(
    [
      thread({ id: "match", title: "Fix Inbox" }),
      thread({ id: "archived", title: "Inbox history", isArchived: true }),
      thread({ id: "miss", title: "Something else" }),
    ],
    " inbox ",
  );

  assert.deepEqual(
    result.grouped.map(({ id }) => id),
    ["match"],
  );
});

test("sorts grouped rows by pin, activity, then id", () => {
  const rows = [
    thread({ id: "recent", updatedAt: 50 }),
    thread({ id: "pinned", isPinned: true, updatedAt: 1 }),
    thread({ id: "old", updatedAt: 2 }),
  ].sort(sortThreads);

  assert.deepEqual(
    rows.map(({ id }) => id),
    ["pinned", "recent", "old"],
  );
});

test("uses the host fallback before the untitled label", () => {
  assert.equal(
    threadTitle(thread({ title: null, titleFallback: "First prompt" })),
    "First prompt",
  );
  assert.equal(
    threadTitle(thread({ title: " ", titleFallback: null })),
    "Untitled thread",
  );
});
