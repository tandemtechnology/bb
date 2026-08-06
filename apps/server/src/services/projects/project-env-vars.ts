import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  deleteProjectEnvVar,
  getProjectEnvVar,
  listProjectEnvVars,
  upsertProjectEnvVar,
  type DbConnection,
} from "@bb/db";
import {
  PROJECT_ENV_VAR_KEY_PATTERN,
  type ProjectEnvVar,
  type SetProjectEnvVarRequest,
} from "@bb/domain";
import { deleteSecretFile, writeSecretFile } from "@bb/secret-storage";

/**
 * Owns the split between project environment variables that live in the
 * database and secret ones that live in 0600 files.
 *
 * Secret values never enter the database and are never returned by a read path,
 * so a database dump or an API response cannot leak them. Only the resolver used
 * to launch a provider session reads them back.
 */

export class ProjectEnvVarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectEnvVarError";
  }
}

function assertSafeKey(key: string): void {
  // The key becomes a file name for secrets. Re-checked here rather than
  // trusting route validation alone, because this is the last point before a
  // path is built from it.
  if (!PROJECT_ENV_VAR_KEY_PATTERN.test(key)) {
    throw new ProjectEnvVarError(`Invalid environment variable name: ${key}`);
  }
}

function projectSecretsDir(dataDir: string, projectId: string): string {
  return join(dataDir, "projects", projectId, "env-secrets");
}

function secretFilePath(
  dataDir: string,
  projectId: string,
  key: string,
): string {
  assertSafeKey(key);
  return join(projectSecretsDir(dataDir, projectId), key);
}

export interface ProjectEnvVarServiceArgs {
  dataDir: string;
  db: DbConnection;
  projectId: string;
}

export interface SetProjectEnvVarArgs extends ProjectEnvVarServiceArgs {
  request: SetProjectEnvVarRequest;
  now: number;
}

export interface DeleteProjectEnvVarServiceArgs extends ProjectEnvVarServiceArgs {
  key: string;
}

/** Read-safe view: secret rows always report `value: null`. */
export function listProjectEnvVarsForDisplay(
  args: ProjectEnvVarServiceArgs,
): ProjectEnvVar[] {
  return listProjectEnvVars(args.db, { projectId: args.projectId }).map(
    (envVar) => (envVar.secret ? { ...envVar, value: null } : envVar),
  );
}

export async function setProjectEnvVar(
  args: SetProjectEnvVarArgs,
): Promise<ProjectEnvVar> {
  const { key, value, secret } = args.request;
  assertSafeKey(key);

  const previous = getProjectEnvVar(args.db, {
    projectId: args.projectId,
    key,
  });

  if (secret) {
    await writeSecretFile(
      secretFilePath(args.dataDir, args.projectId, key),
      value,
    );
  } else if (previous?.secret === true) {
    // Flipping secret -> plain must not leave the old secret readable on disk.
    await deleteSecretFile(secretFilePath(args.dataDir, args.projectId, key));
  }

  return upsertProjectEnvVar(args.db, {
    projectId: args.projectId,
    key,
    value: secret ? null : value,
    secret,
    updatedAt: args.now,
  });
}

export async function removeProjectEnvVar(
  args: DeleteProjectEnvVarServiceArgs,
): Promise<boolean> {
  assertSafeKey(args.key);
  const existing = getProjectEnvVar(args.db, {
    projectId: args.projectId,
    key: args.key,
  });
  if (existing === null) {
    return false;
  }
  if (existing.secret) {
    await deleteSecretFile(
      secretFilePath(args.dataDir, args.projectId, args.key),
    );
  }
  return deleteProjectEnvVar(args.db, {
    projectId: args.projectId,
    key: args.key,
  });
}

/**
 * Removes every stored secret for a project. Deleting the project cascades the
 * database rows, but the secret files are outside the database and would
 * otherwise be left behind on disk.
 */
export async function deleteProjectEnvSecrets(
  dataDir: string,
  projectId: string,
): Promise<void> {
  await rm(projectSecretsDir(dataDir, projectId), {
    force: true,
    recursive: true,
  });
}

/**
 * Resolves the full environment for a provider session, reading secret values
 * back off disk. The only path that returns secret values in cleartext.
 *
 * A secret whose file is missing is skipped rather than passed as an empty
 * string: tools commonly treat a present-but-empty credential var as configured,
 * so an empty value would be a worse failure than an absent one.
 */
export async function resolveProjectEnvVars(
  args: ProjectEnvVarServiceArgs,
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};
  for (const envVar of listProjectEnvVars(args.db, {
    projectId: args.projectId,
  })) {
    if (!envVar.secret) {
      if (envVar.value !== null) {
        resolved[envVar.key] = envVar.value;
      }
      continue;
    }
    try {
      resolved[envVar.key] = await readFile(
        secretFilePath(args.dataDir, args.projectId, envVar.key),
        "utf8",
      );
    } catch (error) {
      const code =
        error instanceof Error && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") {
        throw error;
      }
    }
  }
  return resolved;
}
