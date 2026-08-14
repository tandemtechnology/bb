import type { PluginSidebarThread } from "@bb/plugin-sdk";

export interface InboxProjection {
  inbox: PluginSidebarThread[];
  grouped: PluginSidebarThread[];
}

export function threadTitle(thread: PluginSidebarThread): string {
  return (
    thread.title?.trim() || thread.titleFallback?.trim() || "Untitled thread"
  );
}

/**
 * Adds every visible unread thread or pending interaction to the Inbox while
 * retaining the full visible set in its normal project/group hierarchy.
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

  const inbox = visible
    .filter((thread) => thread.hasPendingInteraction || thread.isUnread)
    .sort(
      (left, right) =>
        right.latestAttentionAt - left.latestAttentionAt ||
        left.id.localeCompare(right.id),
    );

  return {
    inbox,
    grouped: visible,
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
