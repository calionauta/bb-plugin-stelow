/**
 * Running the vendored orchestrator helper.
 *
 * Every stage decision (advance, audit, receipts) is made by the upstream
 * `scripts/stelow` state machine, not reimplemented here: the host's job is
 * to run it in the right directory with the right state, and to report its
 * exit code and streams verbatim. The state directory is passed through the
 * environment rather than as arguments because the helper reads it the same
 * way a worker does.
 */
import { spawn } from "node:child_process";
import { join as nodeJoin } from "node:path";
import { HELPER_SCRIPT } from "../plugin-paths.js";

export type HelperResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

const TRANSITIONS_RELATIVE =
  "skills/stelow-workflow-orchestrator/references/transitions.md";

export function runHelper(
  args: string[],
  cwd: string,
  stateDir?: string,
): Promise<HelperResult> {
  return new Promise((resolveRun) => {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      STELOW_TRANSITIONS: nodeJoin(cwd, TRANSITIONS_RELATIVE),
    };
    if (stateDir) {
      env.STELOW_STATEDIR = stateDir;
      env.STELOW_STATE = nodeJoin(stateDir, "state.md");
    } else {
      // Project-root mode: single state.md for workflows without a
      // per-workflow state dir.
      env.STELOW_STATE = nodeJoin(cwd, "state.md");
    }
    const child = spawn("bash", [HELPER_SCRIPT, ...args], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) =>
      resolveRun({ code: null, stdout, stderr: error.message }),
    );
    child.on("close", (code) => resolveRun({ code, stdout, stderr }));
  });
}
