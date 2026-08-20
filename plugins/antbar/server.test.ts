import assert from "node:assert/strict";
import test from "node:test";
import type { NewThreadRequest } from "@bb/plugin-sdk/app";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@bb/plugin-sdk/testing";
import plugin from "./server.ts";

const request: NewThreadRequest = {
  projectId: "proj_1",
  providerId: "codex",
  model: "gpt-5",
  reasoningLevel: "medium",
  permissionMode: "full",
  executionInputSources: {
    providerId: "explicit",
    model: "explicit",
    reasoningLevel: "explicit",
    permissionMode: "explicit",
  },
  environment: { type: "project-default" },
  input: [
    {
      type: "text",
      text: "Fix the flaky test",
      mentions: [],
    },
  ],
};

test("creates a thread in the selected group", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "antbar",
    sdk: {
      threads: {
        spawn: async (input) =>
          makeThreadResponse({
            id: "thr_new",
            projectId: input.projectId,
            status: "starting",
          }),
      },
    },
  });
  await plugin(bb);

  const created = await harness.behavior.callRpc("createGroup", {
    projectId: request.projectId,
    name: "Needs review",
    color: "",
    emoji: "👀",
  });
  const result = await harness.behavior.callRpc("createThread", {
    request,
    groupId: created.group.id,
  });

  assert.deepEqual(result, { threadId: "thr_new" });
  assert.deepEqual(harness.inspection.sdk.callsTo("threads.spawn")[0]?.[0], {
    ...request,
    origin: "plugin",
    originPluginId: "antbar",
  });
  assert.deepEqual(await harness.behavior.callRpc("allGroups", null), {
    groups: [created.group],
    membership: [{ threadId: "thr_new", groupId: created.group.id }],
  });

  await assert.rejects(
    harness.behavior.callRpc("createThread", {
      request: { ...request, projectId: "proj_2" },
      groupId: created.group.id,
    }),
    /does not belong to proj_2/,
  );
  assert.equal(
    harness.inspection.sdk.callsTo("threads.spawn").length,
    1,
    "project validation should happen before spawning",
  );

  await harness.lifecycle.dispose();
});
