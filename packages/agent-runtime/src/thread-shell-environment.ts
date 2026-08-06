import type { AgentRuntimeShellEnvironment } from "./types.js";

interface ThreadShellEnvironmentArgs {
  environmentId: string;
  projectId?: string;
  /**
   * Project-scoped variables resolved by the server, including secret values
   * read out of their files. Never log this.
   */
  projectEnvVars?: Record<string, string>;
  threadStoragePath?: string;
  threadId: string;
}

interface BuildThreadShellEnvironmentArgs extends ThreadShellEnvironmentArgs {
  baseShellEnv: AgentRuntimeShellEnvironment | undefined;
}

export function buildThreadShellEnvironment(
  args: BuildThreadShellEnvironmentArgs,
): Record<string, string> {
  return {
    ...(args.baseShellEnv ?? {}),
    // Project configuration overrides the daemon's ambient shell, which is
    // whatever happened to launch it. It cannot override bb's own identity
    // variables below: those tell the session which thread it is, and letting a
    // project rewrite them would misroute bb CLI calls made from inside a turn.
    ...(args.projectEnvVars ?? {}),
    ...(args.projectId ? { BB_PROJECT_ID: args.projectId } : {}),
    ...(args.threadStoragePath
      ? { BB_THREAD_STORAGE: args.threadStoragePath }
      : {}),
    BB_THREAD_ID: args.threadId,
    BB_ENVIRONMENT_ID: args.environmentId,
  };
}
