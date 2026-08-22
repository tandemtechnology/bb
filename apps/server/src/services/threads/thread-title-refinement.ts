import {
  getEnvironment,
  getLatestThreadSequence,
  getThread,
  updateThread,
} from "@bb/db";
import type { PromptInput, Thread } from "@bb/domain";
import type { AppDeps, LoggedWorkSessionDeps } from "../../types.js";
import type { CommandResultSideEffectsDeps } from "../../internal/command-result-side-effects.js";
import { INFERENCE_POLICY } from "../ai/inference.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { listAcceptedThreadPromptHistory } from "../prompt-history.js";
import { dispatchThreadRenameCommand } from "./thread-commands.js";
import { buildThreadConversationOutline } from "./timeline.js";
import { generateThreadMetadataWithOutcome } from "./title-generation.js";

/**
 * How many accepted user prompts to feed the title model. Matches the manual
 * regeneration route so both paths see the same amount of user context.
 */
export const TITLE_REGENERATION_HISTORY_LIMIT = 8;

type TitleRegenerationInputDeps = Pick<AppDeps, "db" | "logger">;

export type RegenerateThreadTitleAfterTurnDeps = LoggedWorkSessionDeps &
  CommandResultSideEffectsDeps;

interface RegenerateThreadTitleAfterTurnArgs {
  threadId: string;
}

/**
 * Forward a title to the running provider session, but only when the
 * environment is ready with a workspace path. Best-effort: a missing or
 * not-yet-ready environment simply skips the rename (the persisted title still
 * reaches clients via the `title-changed` notification from `updateThread`).
 */
export function dispatchThreadTitleRenameIfReady(
  deps: CommandResultSideEffectsDeps,
  thread: Pick<Thread, "id" | "environmentId" | "providerId">,
  title: string,
): void {
  if (!thread.environmentId) {
    return;
  }
  const environment = getEnvironment(deps.db, thread.environmentId);
  if (!environment || environment.status !== "ready" || !environment.path) {
    return;
  }
  dispatchThreadRenameCommand(deps, {
    environment: { id: environment.id, hostId: environment.hostId },
    providerId: thread.providerId,
    threadId: thread.id,
    title,
  });
}

/**
 * The agent's response is the point of post-turn naming: a prompt like
 * "investigate <url>" only becomes nameable once the agent has looked. We take
 * the assistant conversation previews from the thread outline (whitespace-
 * normalized, one per assistant message) as that context.
 */
function collectAssistantResponseText(
  deps: Pick<AppDeps, "db">,
  thread: Thread,
): string {
  const maxSeq = getLatestThreadSequence(deps.db, { threadId: thread.id });
  const outline = buildThreadConversationOutline(deps.db, thread, { maxSeq });
  return outline.items
    .filter((item) => item.role === "assistant")
    .map((item) => item.preview.trim())
    .filter((text) => text.length > 0)
    .join("\n");
}

/**
 * Assemble the title-generation context for a thread: the user's prompts (the
 * fallback plus accepted prompt history, as the manual route uses) followed by
 * the agent's response text. Shared by the post-turn pass and the manual
 * `regenerate-title` route so both name from the same material.
 */
export function buildThreadTitleRegenerationInput(
  deps: TitleRegenerationInputDeps,
  thread: Thread,
): PromptInput[] {
  const fallback = thread.titleFallback?.trim();
  const acceptedHistory = listAcceptedThreadPromptHistory(deps, {
    threadId: thread.id,
    limit: TITLE_REGENERATION_HISTORY_LIMIT,
  });
  const userParts: PromptInput[] = [
    ...(fallback
      ? [{ type: "text" as const, text: fallback, mentions: [] }]
      : []),
    ...[...acceptedHistory].reverse().flatMap((entry) => entry.input),
  ];
  const assistantText = collectAssistantResponseText(deps, thread);
  return assistantText.length > 0
    ? [
        ...userParts,
        {
          type: "text" as const,
          text: `Agent response: ${assistantText}`,
          mentions: [],
        },
      ]
    : userParts;
}

/**
 * (Re)generate a thread's title after its first turn, using the prompt plus the
 * agent's response. Runs best-effort off the deferred event-follow-up path.
 *
 * Idempotent by design: it only acts when the current title is still automatic
 * (`null` or `provisional`) and marks the result `refined`, so it fires once and
 * never overwrites a user's manual rename. Generation failures leave the state
 * untouched, so a later turn retries.
 */
export async function regenerateThreadTitleAfterTurn(
  deps: RegenerateThreadTitleAfterTurnDeps,
  args: RegenerateThreadTitleAfterTurnArgs,
): Promise<void> {
  if (!deps.config.refineThreadTitles) {
    return;
  }
  const thread = getThread(deps.db, args.threadId);
  if (
    !thread ||
    thread.deletedAt !== null ||
    thread.archivedAt !== null ||
    thread.titleSource === "refined" ||
    thread.titleSource === "manual"
  ) {
    return;
  }

  const input = buildThreadTitleRegenerationInput(deps, thread);
  if (input.length === 0) {
    return;
  }

  const outcome = await generateThreadMetadataWithOutcome(deps, {
    input,
    threadId: thread.id,
    titleToReplace: thread.title ?? thread.titleFallback ?? null,
    timeoutMaxAttempts: INFERENCE_POLICY.threadMetadata.maxAttempts,
    timeoutMs: INFERENCE_POLICY.threadMetadata.timeoutMs,
  });
  const title = outcome.metadata?.title;
  if (!title) {
    return;
  }

  try {
    const updated = updateThread(deps.db, deps.hub, thread.id, {
      title,
      titleSource: "refined",
    });
    if (updated && title !== thread.title) {
      dispatchThreadTitleRenameIfReady(deps, updated, title);
    }
  } catch (error) {
    deps.logger.warn(
      { threadId: thread.id, ...runtimeErrorLogFields(deps.config, error) },
      "Failed to apply post-turn thread title",
    );
  }
}
