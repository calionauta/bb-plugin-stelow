/**
 * Running the vendored orchestrator helper.
 *
 * Every stage decision (advance, audit, receipts) is made by the upstream
 * `scripts/stelow` state machine, not reimplemented here: the host's job is
 * to run it in the right directory with the right state, and to report its
 * exit code and streams verbatim. The state directory is passed through the
 * environment rather than as arguments because the helper reads it the same
 * way a worker does. The verb is checked against the declared set in
 * `lib/helper-verbs.mjs` before anything spawns: a verb nobody proved cannot
 * become a silent no-op.
 */
import { spawn } from "node:child_process";
import { join as nodeJoin } from "node:path";
import { HELPER_SCRIPT, TRANSITIONS_REF } from "../plugin-paths.js";
import { isDeclaredVerb, undeclaredVerbRefusal } from "../../lib/helper-verbs.mjs";

export type HelperResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

/**
 * The contract the helper enforces against.
 *
 * It used to be the WORKSPACE's copy of `transitions.md` — installed once,
 * only when the workspace lacked it. So a workspace seeded before an
 * upstream sync kept the old graph forever, and a card that reached a stage
 * the old graph did not have could not advance at all. The plugin's
 * vendored copy is the synced, current one; the workspace copy is refreshed
 * on every seed for the workers that read it.
 */
export function runHelper(
  args: string[],
  cwd: string,
  stateDir?: string,
): Promise<HelperResult> {
  const [verb] = args;
  // Fail closed before spawning. A verb this host never proved against the pin
  // used to reach bash, which answered `unknown subcommand` — the same exit code
  // and the same stream shape a real refusal uses, so no caller could tell a
  // typo from a contract change. The declared set is the only door.
  if (!isDeclaredVerb(verb)) {
    return Promise.resolve({
      code: 2,
      stdout: "",
      stderr: undeclaredVerbRefusal(verb),
    });
  }
  return new Promise((resolveRun) => {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      STELOW_TRANSITIONS: TRANSITIONS_REF,
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
