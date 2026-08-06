import { DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG } from "@bb/domain";
import { describe, expect, it } from "vitest";
import type { AgentRuntimeExecutionOptions } from "../types.js";
import { toProviderExecutionContext } from "../execution-options.js";
import { createClaudeCodeProviderAdapter } from "./adapter.js";
import {
  CREDENTIAL_PRECEDENCE_ENV_VARS,
  FABLE_CONFIG_DIR_ENV_VAR,
  isFableModel,
  resolveClaudeAccountEnv,
} from "./account-binding.js";

const HOME = "/home/dev";

function execOpts(model: string): AgentRuntimeExecutionOptions {
  return {
    model,
    serviceTier: "default",
    reasoningLevel: "medium",
    claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
    workflowsEnabled: false,
    permissionMode: "full",
    permissionScope: "full",
    approvalReviewer: null,
    permissionEscalation: null,
  } satisfies AgentRuntimeExecutionOptions;
}

/**
 * Exercises the real production path: the runtime builds an execution context,
 * the adapter turns it into a provider command. A unit test on the resolver
 * alone would not catch the binding being dropped in between.
 */
function threadStartConfig(model: string): Record<string, unknown> {
  const adapter = createClaudeCodeProviderAdapter();
  const plan = adapter.buildCommandPlan({
    type: "thread/start",
    cwd: "/tmp/worktree",
    threadId: "bb-thread-1",
    instructionMode: "append",
    options: toProviderExecutionContext({
      envVars: { BB_THREAD_ID: "bb-thread-1" },
      execOpts: execOpts(model),
      instructions: undefined,
    }),
  });
  const params = plan?.params;
  if (params === undefined || typeof params !== "object") {
    throw new Error("expected command params");
  }
  const config = (params as { config?: unknown }).config;
  return config !== undefined && typeof config === "object"
    ? (config as Record<string, unknown>)
    : {};
}

function resolve(model: string | undefined, env: NodeJS.ProcessEnv = {}) {
  return resolveClaudeAccountEnv({ env, homeDir: HOME, model });
}

describe("isFableModel", () => {
  it("matches the canonical id, the bare alias, and context-window variants", () => {
    // Discovery appends account-scoped rows verbatim, so `[1m]` variants arrive
    // as distinct ids. Missing one would run Fable on the default account.
    for (const model of [
      "claude-fable-5",
      "claude-fable-5[1m]",
      "claude-fable-6",
      "fable",
      "CLAUDE-FABLE-5",
    ]) {
      expect(isFableModel(model), model).toBe(true);
    }
  });

  it("does not claim the `best` alias", () => {
    // `best` resolves to Fable only where entitled, so binding it to the Fable
    // account would silently move ordinary work onto a non-ZDR org. Leaving it
    // on the default account fails in the visible direction instead.
    expect(isFableModel("best")).toBe(false);
  });

  it("does not claim ordinary models", () => {
    for (const model of [
      "claude-opus-4-8",
      "claude-opus-4-8[1m]",
      "claude-sonnet-4-6",
      undefined,
    ]) {
      expect(isFableModel(model), String(model)).toBe(false);
    }
  });
});

describe("resolveClaudeAccountEnv", () => {
  it("leaves non-Fable models on the inherited environment", () => {
    expect(resolve("claude-opus-4-8")).toBeUndefined();
  });

  it("pins Fable to its own config dir and clears credentials that outrank OAuth", () => {
    const result = resolve("claude-fable-5");
    expect(result?.set.CLAUDE_CONFIG_DIR).toBe("/home/dev/.claude-fable");
    expect(result?.set.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS).toBe("1");
    // Every precedence var must be cleared; one survivor shadows the OAuth login.
    expect([...(result?.unset ?? [])].sort()).toEqual(
      [...CREDENTIAL_PRECEDENCE_ENV_VARS].sort(),
    );
  });

  it("honours an explicit config dir override", () => {
    const result = resolve("claude-fable-5", {
      [FABLE_CONFIG_DIR_ENV_VAR]: "/srv/fable-config",
    });
    expect(result?.set.CLAUDE_CONFIG_DIR).toBe("/srv/fable-config");
  });

  it("ignores an empty override rather than pinning to a bare basename", () => {
    const result = resolve("claude-fable-5", {
      [FABLE_CONFIG_DIR_ENV_VAR]: "",
    });
    expect(result?.set.CLAUDE_CONFIG_DIR).toBe("/home/dev/.claude-fable");
  });

  it("returns undefined when no config dir can be derived", () => {
    // The caller turns this into a hard failure. Returning a partial binding
    // here would run Fable against the default account.
    expect(
      resolveClaudeAccountEnv({
        env: {},
        homeDir: undefined,
        model: "claude-fable-5",
      }),
    ).toBeUndefined();
  });

  it("does not produce a doubled separator when home has a trailing slash", () => {
    const result = resolveClaudeAccountEnv({
      env: {},
      homeDir: "/home/dev/",
      model: "claude-fable-5",
    });
    expect(result?.set.CLAUDE_CONFIG_DIR).toBe("/home/dev/.claude-fable");
  });
});

describe("account binding reaches the provider command", () => {
  it("emits config dir and credential unsets for a Fable thread", () => {
    const config = threadStartConfig("claude-fable-5");
    expect(config["shell_environment_policy.set.CLAUDE_CONFIG_DIR"]).toContain(
      ".claude-fable",
    );
    expect(
      config[
        "shell_environment_policy.set.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS"
      ],
    ).toBe("1");
    for (const key of CREDENTIAL_PRECEDENCE_ENV_VARS) {
      expect(
        config[`shell_environment_policy.unset.${key}`],
        `${key} must be cleared`,
      ).toBe("1");
    }
    // Caller-supplied vars still flow through.
    expect(config["shell_environment_policy.set.BB_THREAD_ID"]).toBe(
      "bb-thread-1",
    );
  });

  it("leaves an ordinary thread's environment untouched", () => {
    const config = threadStartConfig("claude-opus-4-8");
    expect(
      config["shell_environment_policy.set.CLAUDE_CONFIG_DIR"],
    ).toBeUndefined();
    for (const key of CREDENTIAL_PRECEDENCE_ENV_VARS) {
      expect(config[`shell_environment_policy.unset.${key}`]).toBeUndefined();
    }
    expect(config["shell_environment_policy.set.BB_THREAD_ID"]).toBe(
      "bb-thread-1",
    );
  });
});
