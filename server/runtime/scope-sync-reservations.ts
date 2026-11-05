import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { HelperResult } from "./helper-script.js";

type Invoke = (args: string[], cwd: string, stateDir?: string) => Promise<HelperResult>;

function ownedFiles(state: string, scope: string, protectedFiles: string[]): string[] {
  const directory = join(state, "locks");
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => name.endsWith(".lock")).flatMap((name) => {
    try {
      const entry = JSON.parse(readFileSync(join(directory, name), "utf8"));
      return entry.scope_id === scope && protectedFiles.includes(entry.file) ? [entry.file] : [];
    } catch {
      return [];
    }
  });
}

/** Retry a transient transport failure, releasing only this operation's reservations. */
export async function releaseScopeSyncReservations(
  invoke: Invoke, cwd: string, state: string, scope: string, protectedFiles: string[],
): Promise<HelperResult> {
  let result: HelperResult = { code: 1, stdout: "", stderr: "Owned reservation release failed" };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const paths = ownedFiles(state, scope, protectedFiles);
      if (!paths.length) return { code: 0, stdout: "", stderr: "" };
      const flags = paths.flatMap((path) => ["--file", path]);
      result = await invoke(["lock", "release", "--scope", scope, ...flags, "--json"], cwd, state);
      if (result.code === 0 && !ownedFiles(state, scope, protectedFiles).length) return result;
      result = { code: 1, stdout: "", stderr: result.stderr || "Owned reservations remain after release" };
    } catch (error) {
      result = { code: 1, stdout: "", stderr: error instanceof Error ? error.message : "Reservation release failed" };
    }
  }
  return result;
}
