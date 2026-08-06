import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection, migrate, type DbConnection } from "@bb/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteProjectEnvSecrets,
  listProjectEnvVarsForDisplay,
  ProjectEnvVarError,
  removeProjectEnvVar,
  resolveProjectEnvVars,
  setProjectEnvVar,
} from "./project-env-vars.js";

const PROJECT_ID = "proj_test";

let db: DbConnection;
let dataDir: string;

function insertProject(): void {
  db.$client
    .prepare(
      "INSERT INTO projects (id, name, created_at, updated_at, sort_key, kind) VALUES (?,?,?,?,?,?)",
    )
    .run(PROJECT_ID, "test", 1, 1, "V", "standard");
}

function secretPath(key: string): string {
  return join(dataDir, "projects", PROJECT_ID, "env-secrets", key);
}

async function set(key: string, value: string, secret: boolean): Promise<void> {
  await setProjectEnvVar({
    dataDir,
    db,
    now: 1,
    projectId: PROJECT_ID,
    request: { key, value, secret },
  });
}

beforeEach(async () => {
  db = createConnection(":memory:");
  migrate(db);
  insertProject();
  dataDir = await mkdtemp(join(tmpdir(), "bb-env-test-"));
});

afterEach(async () => {
  await rm(dataDir, { force: true, recursive: true });
});

describe("project environment variables", () => {
  it("keeps plain values readable and secret values out of the database", async () => {
    await set("PLAIN", "visible", false);
    await set("TOKEN", "s3cret", true);

    const listed = listProjectEnvVarsForDisplay({
      dataDir,
      db,
      projectId: PROJECT_ID,
    });
    expect(listed).toEqual([
      { key: "PLAIN", value: "visible", secret: false, updatedAt: 1 },
      { key: "TOKEN", value: null, secret: true, updatedAt: 1 },
    ]);

    // The point of the split: a database dump must not contain the secret.
    const row = db.$client
      .prepare("SELECT value FROM project_env_vars WHERE key = 'TOKEN'")
      .get() as { value: string | null };
    expect(row.value).toBeNull();
    expect(await readFile(secretPath("TOKEN"), "utf8")).toBe("s3cret");
  });

  it("writes secret files that only the owner can read", async () => {
    await set("TOKEN", "s3cret", true);
    const mode = (await stat(secretPath("TOKEN"))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("resolves both kinds for a provider session", async () => {
    await set("PLAIN", "visible", false);
    await set("TOKEN", "s3cret", true);
    expect(
      await resolveProjectEnvVars({ dataDir, db, projectId: PROJECT_ID }),
    ).toEqual({ PLAIN: "visible", TOKEN: "s3cret" });
  });

  it("preserves an empty plain value", async () => {
    // Distinct from unset: tools commonly treat a present-but-empty variable as
    // configured, so dropping it would change behaviour.
    await set("EMPTY", "", false);
    expect(
      await resolveProjectEnvVars({ dataDir, db, projectId: PROJECT_ID }),
    ).toEqual({ EMPTY: "" });
  });

  it("skips a secret whose file has gone missing rather than passing an empty value", async () => {
    await set("TOKEN", "s3cret", true);
    await rm(secretPath("TOKEN"));
    expect(
      await resolveProjectEnvVars({ dataDir, db, projectId: PROJECT_ID }),
    ).toEqual({});
  });

  it("removes the secret file when a key is flipped to plain", async () => {
    await set("TOKEN", "s3cret", true);
    await set("TOKEN", "now-plain", false);

    expect(
      await resolveProjectEnvVars({ dataDir, db, projectId: PROJECT_ID }),
    ).toEqual({ TOKEN: "now-plain" });
    // A leftover file would keep the old secret readable on disk forever.
    await expect(readFile(secretPath("TOKEN"), "utf8")).rejects.toThrow();
  });

  it("removes the secret file on unset", async () => {
    await set("TOKEN", "s3cret", true);
    expect(
      await removeProjectEnvVar({
        dataDir,
        db,
        key: "TOKEN",
        projectId: PROJECT_ID,
      }),
    ).toBe(true);
    await expect(readFile(secretPath("TOKEN"), "utf8")).rejects.toThrow();
  });

  it("reports an unknown key so the route can 404", async () => {
    expect(
      await removeProjectEnvVar({
        dataDir,
        db,
        key: "NOPE",
        projectId: PROJECT_ID,
      }),
    ).toBe(false);
  });

  it("clears every secret when the project is deleted", async () => {
    await set("TOKEN", "s3cret", true);
    await deleteProjectEnvSecrets(dataDir, PROJECT_ID);
    await expect(readFile(secretPath("TOKEN"), "utf8")).rejects.toThrow();
  });

  it("rejects keys that could escape the secrets directory", async () => {
    // The key becomes a file name, so traversal must not reach the filesystem.
    for (const key of ["../escape", "a/b", "with space", "1LEADING_DIGIT"]) {
      await expect(set(key, "x", true)).rejects.toBeInstanceOf(
        ProjectEnvVarError,
      );
    }
  });
});
