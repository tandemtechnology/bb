import { getThread } from "@bb/db";
import { threadSchema } from "@bb/domain";
import { apiErrorSchema } from "@bb/server-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const piAiMocks = vi.hoisted(() => ({
  complete: vi.fn(),
  getModel: vi.fn(),
}));

vi.mock("@earendil-works/pi-ai/providers/all", () => ({
  builtinModels: () => ({
    complete: piAiMocks.complete,
    getModel: piAiMocks.getModel,
  }),
}));

function mockGeneratedTitle(title: string): void {
  piAiMocks.getModel.mockReturnValue({ provider: "test" });
  piAiMocks.complete.mockResolvedValue({
    content: [
      {
        arguments: { title },
        id: "tool_result",
        name: "result",
        type: "toolCall",
      },
    ],
  });
}

describe("public thread title regeneration", () => {
  beforeEach(() => {
    piAiMocks.complete.mockReset();
    piAiMocks.getModel.mockReset();
  });

  it("replaces an existing title using the initial prompt", async () => {
    mockGeneratedTitle("A much clearer thread title");
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-regenerate-thread-title",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        title: "Bad title",
        titleFallback: "Please improve the confusing sidebar thread title",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/regenerate-title`,
        { method: "POST" },
      );

      expect(response.status).toBe(200);
      const updated = threadSchema.parse(await readJson(response));
      expect(updated.title).toBe("A much clearer thread title");
      expect(getThread(harness.db, thread.id)?.title).toBe(
        "A much clearer thread title",
      );
      expect(piAiMocks.complete).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps the existing title when the initial prompt is too short", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-short-thread-title-source",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        title: "Keep this title",
        titleFallback: "Fix title",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/regenerate-title`,
        { method: "POST" },
      );

      expect(response.status).toBe(409);
      expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
        code: "thread_title_source_unavailable",
      });
      expect(getThread(harness.db, thread.id)?.title).toBe("Keep this title");
      expect(piAiMocks.complete).not.toHaveBeenCalled();
    });
  });
});
