import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveGroupId,
  familyRootId,
  familyThreadIds,
  indexThreads,
  nestThreads,
  type ThreadFamilyLink,
} from "./thread-family.ts";

interface TestThread extends ThreadFamilyLink {
  order: number;
}

const thread = (
  id: string,
  parentThreadId: string | null,
  order: number,
): TestThread => ({ id, parentThreadId, order });

test("resolves every descendant to the same family root", () => {
  const threads = indexThreads([
    thread("root", null, 1),
    thread("child", "root", 2),
    thread("grandchild", "child", 3),
  ]);

  assert.equal(familyRootId("root", threads), "root");
  assert.equal(familyRootId("child", threads), "root");
  assert.equal(familyRootId("grandchild", threads), "root");
  assert.deepEqual([...familyThreadIds("root", threads)].sort(), [
    "child",
    "grandchild",
    "root",
  ]);
});

test("uses only the root membership for the whole family", () => {
  const threads = indexThreads([
    thread("root", null, 1),
    thread("child", "root", 2),
  ]);
  const membership = new Map([
    ["root", "group-a"],
    ["child", "stale-group"],
  ]);

  assert.equal(effectiveGroupId("root", threads, membership), "group-a");
  assert.equal(effectiveGroupId("child", threads, membership), "group-a");
});

test("nests children immediately below sorted parents", () => {
  const rows = nestThreads(
    [
      thread("child-b", "root", 4),
      thread("other-root", null, 2),
      thread("grandchild", "child-a", 1),
      thread("root", null, 3),
      thread("child-a", "root", 5),
    ],
    (left, right) => right.order - left.order,
  );

  assert.deepEqual(
    rows.map(({ thread: row, depth }) => [row.id, depth]),
    [
      ["root", 0],
      ["child-a", 1],
      ["grandchild", 2],
      ["child-b", 1],
      ["other-root", 0],
    ],
  );
});

test("handles missing parents and cycles without dropping threads", () => {
  const missingParent = thread("orphan", "missing", 3);
  const cycleA = thread("cycle-a", "cycle-b", 2);
  const cycleB = thread("cycle-b", "cycle-a", 1);
  const threads = indexThreads([missingParent, cycleA, cycleB]);

  assert.equal(familyRootId("orphan", threads), "missing");
  assert.equal(familyRootId("cycle-a", threads), "cycle-a");
  assert.equal(familyRootId("cycle-b", threads), "cycle-a");
  assert.deepEqual(
    nestThreads([missingParent, cycleA, cycleB], (a, b) => b.order - a.order)
      .map(({ thread: row }) => row.id)
      .sort(),
    ["cycle-a", "cycle-b", "orphan"],
  );
});
