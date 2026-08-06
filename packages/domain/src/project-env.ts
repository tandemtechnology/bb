import { z } from "zod";

/**
 * Project-scoped environment variables injected into every provider session bb
 * runs for that project.
 *
 * Without these, a thread's environment is whatever shell happened to launch the
 * host daemon — which is invisible from the app, differs between a desktop
 * launch and a terminal launch, and cannot be reviewed. These make the parts a
 * project depends on explicit.
 *
 * Values marked secret are not stored in the database. Only the key and the
 * secret marker are; the value lives in a 0600 file under the data directory,
 * and every read path returns it redacted.
 */

/**
 * POSIX environment variable name. Also the basename of the on-disk secret file,
 * so the pattern must exclude path separators and dots.
 */
export const PROJECT_ENV_VAR_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export const projectEnvVarKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    PROJECT_ENV_VAR_KEY_PATTERN,
    "Environment variable names may contain only letters, digits, and underscores, and may not start with a digit.",
  );

export const projectEnvVarSchema = z.object({
  key: projectEnvVarKeySchema,
  /**
   * `null` when the variable is secret: the caller is not permitted to read it
   * back. Distinct from an empty string, which is a legitimate value that
   * Claude Code and other tools treat as "configured".
   */
  value: z.string().nullable(),
  secret: z.boolean(),
  updatedAt: z.number(),
});
export type ProjectEnvVar = z.infer<typeof projectEnvVarSchema>;

export const projectEnvVarListSchema = z.object({
  envVars: z.array(projectEnvVarSchema),
});
export type ProjectEnvVarList = z.infer<typeof projectEnvVarListSchema>;

export const setProjectEnvVarRequestSchema = z.object({
  key: projectEnvVarKeySchema,
  value: z.string(),
  /**
   * Store the value in a secret file rather than the database, and redact it
   * from every read path. Omitted means a plain, readable value — the choice is
   * semantic, so it is not defaulted silently at a lower layer.
   */
  secret: z.boolean(),
});
export type SetProjectEnvVarRequest = z.infer<
  typeof setProjectEnvVarRequestSchema
>;

/** Redaction placeholder shown wherever a secret value would otherwise appear. */
export const PROJECT_ENV_SECRET_PLACEHOLDER = "<secret>";
