import { getThread, updateThread } from "@bb/db";
import { turnScope } from "@bb/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  seedHostSession,
  seedProjectWithSource,
  seedStoredEvent,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import { regenerateThreadTitleAfterTurn } from "../../src/services/threads/thread-title-refinement.js";

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

// The post-turn pass names from the prompt plus the agent's response, so a
// seeded thread needs at least one completed assistant message in its timeline.
function seedAssistantTurn(
  harness: TestAppHarness,
  args: { threadId: string; text: string },
): void {
  const providerThreadId = "provider-refine";
  seedStoredEvent(harness.deps, {
    threadId: args.threadId,
    providerThreadId,
    sequence: 1,
    type: "turn/started",
    scope: turnScope("turn-refine"),
    data: { providerThreadId },
  });
  seedStoredEvent(harness.deps, {
    threadId: args.threadId,
    providerThreadId,
    sequence: 2,
    type: "item/completed",
    scope: turnScope("turn-refine"),
    itemId: "message-refine",
    itemKind: "agentMessage",
    data: {
      item: { id: "message-refine", type: "agentMessage", text: args.text },
    },
  });
}

function seedRefinableThread(harness: TestAppHarness): string {
  const { host } = seedHostSession(harness.deps, { id: "host-refine-title" });
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    titleFallback: "investigate the linked slack thread about deploys",
  });
  // Local thread named only after the first turn: clear the seed helper's
  // default title so it starts genuinely unnamed (fallback shown).
  updateThread(harness.deps.db, harness.deps.hub, thread.id, {
    title: null,
    titleSource: null,
  });
  seedAssistantTurn(harness, {
    threadId: thread.id,
    text: "The Slack thread reports the staging deploy pipeline failing on an expired token.",
  });
  return thread.id;
}

describe("post-turn thread title refinement", () => {
  beforeEach(() => {
    piAiMocks.complete.mockReset();
    piAiMocks.getModel.mockReset();
  });

  it("names an unnamed thread from the prompt and the agent's response", async () => {
    mockGeneratedTitle("Fix staging deploy token");
    await withTestHarness(
      { refineThreadTitles: true, inferenceModel: "openai/gpt-4o-mini" },
      async (harness) => {
        const threadId = seedRefinableThread(harness);

        await regenerateThreadTitleAfterTurn(harness.deps, { threadId });

        const refined = getThread(harness.db, threadId);
        expect(refined?.title).toBe("Fix staging deploy token");
        expect(refined?.titleSource).toBe("refined");
        // The agent's response must reach the title model — that is the whole
        // point of naming after the turn rather than from the first message.
        expect(piAiMocks.complete).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            messages: [
              expect.objectContaining({
                content: expect.stringContaining(
                  "staging deploy pipeline failing on an expired token",
                ),
              }),
            ],
          }),
          expect.objectContaining({ signal: expect.anything() }),
        );
      },
    );
  });

  it("replaces a provisional title but marks the result refined", async () => {
    mockGeneratedTitle("Fix staging deploy token");
    await withTestHarness(
      { refineThreadTitles: true, inferenceModel: "openai/gpt-4o-mini" },
      async (harness) => {
        const threadId = seedRefinableThread(harness);
        updateThread(harness.deps.db, harness.deps.hub, threadId, {
          title: "Investigate the linked slack",
          titleSource: "provisional",
        });

        await regenerateThreadTitleAfterTurn(harness.deps, { threadId });

        const refined = getThread(harness.db, threadId);
        expect(refined?.title).toBe("Fix staging deploy token");
        expect(refined?.titleSource).toBe("refined");
      },
    );
  });

  it("never overwrites a user's manual title", async () => {
    mockGeneratedTitle("Model chosen title");
    await withTestHarness(
      { refineThreadTitles: true, inferenceModel: "openai/gpt-4o-mini" },
      async (harness) => {
        const threadId = seedRefinableThread(harness);
        updateThread(harness.deps.db, harness.deps.hub, threadId, {
          title: "My hand-picked name",
          titleSource: "manual",
        });

        await regenerateThreadTitleAfterTurn(harness.deps, { threadId });

        expect(getThread(harness.db, threadId)?.title).toBe(
          "My hand-picked name",
        );
        expect(piAiMocks.complete).not.toHaveBeenCalled();
      },
    );
  });

  it("does not run a second time once refined", async () => {
    mockGeneratedTitle("Fix staging deploy token");
    await withTestHarness(
      { refineThreadTitles: true, inferenceModel: "openai/gpt-4o-mini" },
      async (harness) => {
        const threadId = seedRefinableThread(harness);
        updateThread(harness.deps.db, harness.deps.hub, threadId, {
          titleSource: "refined",
        });

        await regenerateThreadTitleAfterTurn(harness.deps, { threadId });

        expect(piAiMocks.complete).not.toHaveBeenCalled();
      },
    );
  });

  it("does nothing when the feature is disabled", async () => {
    mockGeneratedTitle("Fix staging deploy token");
    await withTestHarness(
      { refineThreadTitles: false, inferenceModel: "openai/gpt-4o-mini" },
      async (harness) => {
        const threadId = seedRefinableThread(harness);

        await regenerateThreadTitleAfterTurn(harness.deps, { threadId });

        const thread = getThread(harness.db, threadId);
        expect(thread?.title).toBeNull();
        expect(thread?.titleSource).toBeNull();
        expect(piAiMocks.complete).not.toHaveBeenCalled();
      },
    );
  });
});
