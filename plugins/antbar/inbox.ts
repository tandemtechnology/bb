import type { PluginSidebarThread } from "@bb/plugin-sdk";

export interface InboxProjection {
  needsInput: PluginSidebarThread[];
  remaining: PluginSidebarThread[];
}

export function threadTitle(thread: PluginSidebarThread): string {
  return (
    thread.title?.trim() || thread.titleFallback?.trim() || "Untitled thread"
  );
}

/**
 * Promotes every visible pending interaction into the Inbox. Promoted threads
 * are removed from the grouped tree so each thread has one keyboard target.
 */
export function projectInbox(
  threads: readonly PluginSidebarThread[],
  searchQuery: string,
): InboxProjection {
  const query = searchQuery.trim().toLocaleLowerCase();
  const visible = threads.filter(
    (thread) =>
      !thread.isArchived &&
      (query.length === 0 ||
        threadTitle(thread).toLocaleLowerCase().includes(query)),
  );

  const needsInput = visible
    .filter((thread) => thread.hasPendingInteraction)
    .sort(
      (left, right) =>
        right.latestAttentionAt - left.latestAttentionAt ||
        left.id.localeCompare(right.id),
    );
  const waitingIds = new Set(needsInput.map((thread) => thread.id));

  return {
    needsInput,
    remaining: visible.filter((thread) => !waitingIds.has(thread.id)),
  };
}

export function sortThreads(
  left: PluginSidebarThread,
  right: PluginSidebarThread,
): number {
  return (
    Number(right.isPinned) - Number(left.isPinned) ||
    right.updatedAt - left.updatedAt ||
    left.id.localeCompare(right.id)
  );
}
