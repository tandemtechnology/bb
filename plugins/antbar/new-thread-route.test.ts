import assert from "node:assert/strict";
import test from "node:test";
import { groupThreadRoute, parseGroupThreadRoute } from "./new-thread-route.ts";

test("round-trips project and group ids for the group composer route", () => {
  const route = groupThreadRoute({
    projectId: "proj/team one",
    groupId: "grp/review",
  });

  assert.equal(route, "new-thread/proj%2Fteam%20one/grp%2Freview");
  assert.deepEqual(parseGroupThreadRoute(route), {
    projectId: "proj/team one",
    groupId: "grp/review",
  });
});

test("rejects unrelated or malformed group composer routes", () => {
  assert.equal(parseGroupThreadRoute(""), null);
  assert.equal(parseGroupThreadRoute("groups/proj_1/grp_1"), null);
  assert.equal(parseGroupThreadRoute("new-thread/proj_1"), null);
  assert.equal(parseGroupThreadRoute("new-thread/%E0%A4%A/grp_1"), null);
  assert.equal(parseGroupThreadRoute("new-thread/proj_1/grp_1/extra"), null);
});
