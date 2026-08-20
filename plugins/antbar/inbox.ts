import type { PluginSidebarThread } from "@bb/plugin-sdk";
import { indexThreads } from "./thread-family.ts";

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
  const available = threads.filter((thread) => !thread.isArchived);
  const availableById = indexThreads(available);
  const matched = available.filter(
    (thread) =>
      query.length === 0 ||
      threadTitle(thread).toLocaleLowerCase().includes(query),
  );

  const groupedIds = new Set(matched.map((thread) => thread.id));
  if (query.length > 0) {
    for (const thread of matched) {
      let parentId = thread.parentThreadId;
      const visited = new Set<string>();
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = availableById.get(parentId);
        if (!parent) break;
        groupedIds.add(parent.id);
        parentId = parent.parentThreadId;
      }
    }
  }

  const grouped = available.filter((thread) => groupedIds.has(thread.id));

  const inbox = matched
    .filter((thread) => thread.hasPendingInteraction || thread.isUnread)
    .sort(
      (left, right) =>
        right.latestAttentionAt - left.latestAttentionAt ||
        left.id.localeCompare(right.id),
    );

  return {
    inbox,
    grouped,
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
