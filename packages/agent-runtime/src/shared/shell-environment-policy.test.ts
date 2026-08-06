import { describe, expect, it } from "vitest";
import {
  buildShellEnvironmentPolicyConfig,
  SHELL_ENV_POLICY_SET_PREFIX,
  SHELL_ENV_POLICY_UNSET_PREFIX,
} from "./adapter-utils.js";

describe("buildShellEnvironmentPolicyConfig", () => {
  it("returns undefined when there is nothing to apply", () => {
    expect(buildShellEnvironmentPolicyConfig({})).toBeUndefined();
    expect(
      buildShellEnvironmentPolicyConfig({ envVars: {}, unsetVars: [] }),
    ).toBeUndefined();
  });

  it("emits set and unset directives under distinct prefixes", () => {
    expect(
      buildShellEnvironmentPolicyConfig({
        envVars: { BB_THREAD_ID: "thr_1" },
        unsetVars: ["ANTHROPIC_API_KEY"],
      }),
    ).toEqual({
      [`${SHELL_ENV_POLICY_SET_PREFIX}BB_THREAD_ID`]: "thr_1",
      [`${SHELL_ENV_POLICY_UNSET_PREFIX}ANTHROPIC_API_KEY`]: "1",
    });
  });

  it("lets unset win when a key is both set and unset", () => {
    // Otherwise the outcome would depend on object key ordering downstream, and
    // a credential var the account binding removed could be reinstated.
    const config = buildShellEnvironmentPolicyConfig({
      envVars: { CLAUDE_CODE_USE_VERTEX: "1" },
      unsetVars: ["CLAUDE_CODE_USE_VERTEX"],
    });
    expect(config).toEqual({
      [`${SHELL_ENV_POLICY_UNSET_PREFIX}CLAUDE_CODE_USE_VERTEX`]: "1",
    });
    expect(
      config?.[`${SHELL_ENV_POLICY_SET_PREFIX}CLAUDE_CODE_USE_VERTEX`],
    ).toBeUndefined();
  });

  it("drops keys that are not valid environment variable names", () => {
    expect(
      buildShellEnvironmentPolicyConfig({
        envVars: { "not a var": "x" },
        unsetVars: ["also bad"],
      }),
    ).toBeUndefined();
  });
});
