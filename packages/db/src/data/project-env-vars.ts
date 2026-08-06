import { and, asc, eq } from "drizzle-orm";
import type { ProjectEnvVar } from "@bb/domain";
import type { DbConnection } from "../connection.js";
import { projectEnvVars } from "../schema.js";

export interface ListProjectEnvVarsArgs {
  projectId: string;
}

export interface UpsertProjectEnvVarArgs extends ListProjectEnvVarsArgs {
  key: string;
  /** Null for secrets; the value is held in a secret file instead. */
  value: string | null;
  secret: boolean;
  updatedAt: number;
}

export interface DeleteProjectEnvVarArgs extends ListProjectEnvVarsArgs {
  key: string;
}

/**
 * Rows as stored. Secret rows carry `value: null`; redaction for display is the
 * caller's concern, so nothing here has to know about placeholders.
 */
export function listProjectEnvVars(
  db: DbConnection,
  args: ListProjectEnvVarsArgs,
): ProjectEnvVar[] {
  return db
    .select({
      key: projectEnvVars.key,
      value: projectEnvVars.value,
      secret: projectEnvVars.secret,
      updatedAt: projectEnvVars.updatedAt,
    })
    .from(projectEnvVars)
    .where(eq(projectEnvVars.projectId, args.projectId))
    .orderBy(asc(projectEnvVars.key))
    .all();
}

export function getProjectEnvVar(
  db: DbConnection,
  args: DeleteProjectEnvVarArgs,
): ProjectEnvVar | null {
  const row = db
    .select({
      key: projectEnvVars.key,
      value: projectEnvVars.value,
      secret: projectEnvVars.secret,
      updatedAt: projectEnvVars.updatedAt,
    })
    .from(projectEnvVars)
    .where(
      and(
        eq(projectEnvVars.projectId, args.projectId),
        eq(projectEnvVars.key, args.key),
      ),
    )
    .get();

  return row ?? null;
}

export function upsertProjectEnvVar(
  db: DbConnection,
  args: UpsertProjectEnvVarArgs,
): ProjectEnvVar {
  db.insert(projectEnvVars)
    .values({
      projectId: args.projectId,
      key: args.key,
      value: args.value,
      secret: args.secret,
      updatedAt: args.updatedAt,
    })
    .onConflictDoUpdate({
      target: [projectEnvVars.projectId, projectEnvVars.key],
      set: {
        value: args.value,
        secret: args.secret,
        updatedAt: args.updatedAt,
      },
    })
    .run();

  return {
    key: args.key,
    value: args.value,
    secret: args.secret,
    updatedAt: args.updatedAt,
  };
}

/** Returns whether a row was removed, so callers can 404 on an unknown key. */
export function deleteProjectEnvVar(
  db: DbConnection,
  args: DeleteProjectEnvVarArgs,
): boolean {
  const result = db
    .delete(projectEnvVars)
    .where(
      and(
        eq(projectEnvVars.projectId, args.projectId),
        eq(projectEnvVars.key, args.key),
      ),
    )
    .run();

  return result.changes > 0;
}
