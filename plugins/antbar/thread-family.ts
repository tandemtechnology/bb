export interface ThreadFamilyLink {
  id: string;
  parentThreadId: string | null;
}

export interface NestedThread<T extends ThreadFamilyLink> {
  thread: T;
  depth: number;
}

export function indexThreads<T extends ThreadFamilyLink>(
  threads: readonly T[],
): ReadonlyMap<string, T> {
  return new Map(threads.map((thread) => [thread.id, thread]));
}

export function familyRootId<T extends ThreadFamilyLink>(
  threadId: string,
  threadsById: ReadonlyMap<string, T>,
): string {
  let currentId = threadId;
  const visited = new Set<string>();

  while (true) {
    if (visited.has(currentId)) {
      return [...visited].sort()[0] ?? threadId;
    }
    visited.add(currentId);

    const current = threadsById.get(currentId);
    if (!current?.parentThreadId) return currentId;
    currentId = current.parentThreadId;
  }
}

export function familyThreadIds<T extends ThreadFamilyLink>(
  rootId: string,
  threadsById: ReadonlyMap<string, T>,
): readonly string[] {
  return [...threadsById.keys()].filter(
    (threadId) => familyRootId(threadId, threadsById) === rootId,
  );
}

export function effectiveGroupId<T extends ThreadFamilyLink>(
  threadId: string,
  threadsById: ReadonlyMap<string, T>,
  membership: ReadonlyMap<string, string>,
): string | null {
  return membership.get(familyRootId(threadId, threadsById)) ?? null;
}

export function nestThreads<T extends ThreadFamilyLink>(
  threads: readonly T[],
  compare: (left: T, right: T) => number,
): readonly NestedThread<T>[] {
  const includedIds = new Set(threads.map((thread) => thread.id));
  const children = new Map<string, T[]>();
  const roots: T[] = [];

  for (const thread of threads) {
    if (thread.parentThreadId && includedIds.has(thread.parentThreadId)) {
      const siblings = children.get(thread.parentThreadId) ?? [];
      siblings.push(thread);
      children.set(thread.parentThreadId, siblings);
    } else {
      roots.push(thread);
    }
  }

  roots.sort(compare);
  for (const siblings of children.values()) siblings.sort(compare);

  const nested: NestedThread<T>[] = [];
  const visited = new Set<string>();
  const visit = (thread: T, depth: number) => {
    if (visited.has(thread.id)) return;
    visited.add(thread.id);
    nested.push({ thread, depth });
    for (const child of children.get(thread.id) ?? []) {
      visit(child, depth + 1);
    }
  };

  for (const root of roots) visit(root, 0);
  for (const orphan of [...threads].sort(compare)) visit(orphan, 0);
  return nested;
}
