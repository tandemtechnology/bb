import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_PRECEDENCE_ENV_VARS,
  FABLE_CONFIG_DIR_ENV_VAR,
  isFableModel,
  resolveClaudeAccountEnv,
} from "./account-binding.js";

describe("Claude account binding", () => {
  it("recognizes explicit Fable ids and qualifiers but not best", () => {
    for (const model of [
      "claude-fable-5",
      "claude-fable-5[1m]",
      "claude-fable-6",
      "fable",
      "CLAUDE-FABLE-5",
    ]) expect(isFableModel(model), model).toBe(true);
    expect(isFableModel("best")).toBe(false);
    expect(isFableModel("claude-opus-4-8")).toBe(false);
  });

  it("pins Fable to a separate config and strips credential overrides", () => {
    const result = resolveClaudeAccountEnv({
      env: {},
      homeDir: "/home/dev/",
      model: "claude-fable-5",
    });
    expect(result?.set).toEqual({
      CLAUDE_CONFIG_DIR: "/home/dev/.claude-fable",
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
    });
    expect([...(result?.unset ?? [])].sort()).toEqual(
      [...CREDENTIAL_PRECEDENCE_ENV_VARS].sort(),
    );
  });

  it("honors the explicit config override", () => {
    expect(
      resolveClaudeAccountEnv({
        env: { [FABLE_CONFIG_DIR_ENV_VAR]: "/srv/fable" },
        homeDir: "/home/dev",
        model: "fable",
      })?.set.CLAUDE_CONFIG_DIR,
    ).toBe("/srv/fable");
  });
});
