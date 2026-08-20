/**
 * Binds a Claude model to the local Claude Code account it must run under.
 *
 * Some models are only entitled on a specific Anthropic org, and orgs differ in
 * their data-retention terms. Fable is the motivating case: it is available only
 * on a 1P Console org (not on Vertex or Bedrock), and that org is BAA-covered but
 * NOT zero-data-retention. Running everyday work there would put it under a
 * non-ZDR agreement, so Fable gets its own `CLAUDE_CONFIG_DIR` — a separate
 * credential store, MCP set, and history — and every other model keeps using the
 * default account.
 *
 * Selecting the model is what selects the account. There is deliberately no way
 * to run Fable against the default account: a per-thread toggle would be a
 * compliance footgun.
 */

/**
 * Env vars that outrank an OAuth login in Claude Code's auth resolution order.
 *
 * Setting `CLAUDE_CONFIG_DIR` alone is not enough to switch accounts: if any of
 * these is present in the inherited environment it shadows the OAuth credential
 * in that directory and the session silently runs against the wrong provider or
 * org. The daemon inherits whatever shell started it — in a dev container that
 * routinely includes the Vertex trio — so they must be actively removed, not
 * merely left unset.
 */
export const CREDENTIAL_PRECEDENCE_ENV_VARS: readonly string[] = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLOUD_ML_REGION",
];

/** Overrides the config directory used for Fable sessions. */
export const FABLE_CONFIG_DIR_ENV_VAR = "BB_CLAUDE_FABLE_CONFIG_DIR";

const FABLE_CONFIG_DIR_BASENAME = ".claude-fable";

/**
 * Model IDs that unambiguously mean Fable, after context-window suffix removal.
 *
 * Deliberately excludes the moving `best` alias, which the catalog documents as
 * resolving to "Fable 5 where available" — i.e. it resolves to Fable only on an
 * account already entitled to it, and to a non-Fable model elsewhere. bb cannot
 * tell which without asking the account, and the two possible mistakes are not
 * symmetric:
 *
 * - Running a Fable model on the default account fails on entitlement. Visible,
 *   and no data lands anywhere it shouldn't.
 * - Running a non-Fable model on the Fable account silently puts ordinary work
 *   under a non-ZDR agreement.
 *
 * So the binding only fires when the id is certainly Fable, and `best` keeps the
 * default account. A user who wants Fable should select it by name.
 */
const EXACT_FABLE_MODEL_IDS: readonly string[] = ["fable"];
const FABLE_MODEL_ID_PREFIX = "claude-fable-";

/**
 * Strips a trailing context-window qualifier such as the `[1m]` in
 * `claude-fable-5[1m]`. Discovery appends account-scoped rows verbatim, so these
 * variants reach us as distinct ids and must not bypass the binding.
 */
function stripModelQualifier(model: string): string {
  return model.replace(/\[[^\]]*\]$/u, "");
}

export interface ClaudeAccountEnv {
  /** Applied over the inherited environment. */
  set: Record<string, string>;
  /** Removed from the inherited environment, after `set` is applied. */
  unset: readonly string[];
}

export interface ResolveClaudeAccountEnvArgs {
  /** Home directory used to derive the default Fable config dir. */
  homeDir: string | undefined;
  /** Selected model id; `undefined` when the provider default is used. */
  model: string | undefined;
  /** Process environment, read for {@link FABLE_CONFIG_DIR_ENV_VAR}. */
  env: NodeJS.ProcessEnv;
}

export function isFableModel(model: string | undefined): boolean {
  if (model === undefined) {
    return false;
  }
  const normalized = stripModelQualifier(model).toLowerCase();
  return (
    EXACT_FABLE_MODEL_IDS.includes(normalized) ||
    normalized.startsWith(FABLE_MODEL_ID_PREFIX)
  );
}

function resolveFableConfigDir(
  args: ResolveClaudeAccountEnvArgs,
): string | undefined {
  const configured = args.env[FABLE_CONFIG_DIR_ENV_VAR];
  if (configured !== undefined && configured.length > 0) {
    return configured;
  }
  if (args.homeDir === undefined || args.homeDir.length === 0) {
    return undefined;
  }
  return `${args.homeDir.replace(/\/+$/u, "")}/${FABLE_CONFIG_DIR_BASENAME}`;
}

/**
 * Returns the environment changes needed to run `model` on its required account,
 * or `undefined` when the model uses the default account and the inherited
 * environment should be left alone.
 *
 * Returns `undefined` for Fable too when no config directory can be determined,
 * so the caller can fail loudly rather than quietly running Fable on the default
 * account.
 */
export function resolveClaudeAccountEnv(
  args: ResolveClaudeAccountEnvArgs,
): ClaudeAccountEnv | undefined {
  if (!isFableModel(args.model)) {
    return undefined;
  }

  const configDir = resolveFableConfigDir(args);
  if (configDir === undefined) {
    return undefined;
  }

  return {
    set: {
      CLAUDE_CONFIG_DIR: configDir,
      // The Fable-eligible org is non-ZDR, and Claude Code's experimental beta
      // headers are rejected for HIPAA-regulated orgs without ZDR — the request
      // 400s on `context_management`. Scoped to Fable sessions only.
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
    },
    unset: CREDENTIAL_PRECEDENCE_ENV_VARS,
  };
}
