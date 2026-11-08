import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_HELPER_VERBS } from "../lib/helper-verbs.mjs";
import { runHelper } from "../server/runtime/helper-script.ts";

/**
 * The host may only call helper verbs it proved against the pin.
 *
 * The failure this guards is not hypothetical. The host called
 * `runHelper(["artifacts","add",…])` — a verb the pinned helper answers with
 * `unknown subcommand 'artifacts'` and exit 2 — for a whole cycle, and the only
 * reason it surfaced at all is that a human read the code. Nothing failed: the
 * runner is generic, the exit code matched a real refusal, and no test ever
 * asked whether the verb existed.
 *
 * Two guards, because each sees something the other cannot:
 *
 *   1. PROBE — every declared verb is answered by the vendored binary. Catches a
 *      pin whose contract moved, and a declaration nobody checked.
 *   2. FUNNEL — a verb that is not declared never reaches bash. Catches every
 *      call site, including the ones no static read can see (a computed
 *      argument, a wrapper): the refusal happens at first execution, before the
 *      spawn, and names both the verb and the declared set.
 *
 * A third guard was written and then deleted on purpose: a source scan asserting
 * that every literal first argument in `server/` names a declared verb. It would
 * have caught a new call site at commit time, which sounds strictly better — and
 * it is a source-text pin, the one class `tests/source-pins-guard.test.mjs`
 * ratchets DOWN because it passes on broken logic and breaks on refactors. The
 * repo's answer to "I want commit-time coverage" is a behavioral seam, and
 * "which call sites exist" has none; the funnel is the door. What is lost is
 * named in the audit's scope-1 Record, not hidden here.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const helper = join(root, "data", "stelow");

assert.ok(HOST_HELPER_VERBS.length >= 7, "the declared verb set is not accidentally empty");
assert.equal(
  new Set(HOST_HELPER_VERBS).size,
  HOST_HELPER_VERBS.length,
  "every declared verb appears once",
);

// --- 1. PROBE ---------------------------------------------------------------
// `--help` is the cheapest probe that cannot mutate state. A verb the helper
// does not know answers through its dispatcher, naming the offending word:
// `stelow: unknown subcommand 'artifacts'`. `schema` answers about the FLAG it
// was given, so the pattern has to name the verb, not the phrase.
for (const verb of HOST_HELPER_VERBS) {
  const run = spawnSync("bash", [helper, verb, "--help"], { cwd: root, encoding: "utf8" });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const unknown = new RegExp(`unknown (sub)?command '${verb}'`);
  assert.ok(
    !unknown.test(output),
    `the pinned helper does not answer '${verb}': ${output.trim().slice(0, 200)}`,
  );
}

// --- 2. FUNNEL -------------------------------------------------------------
// The refusal is a HelperResult, not a throw: every call site already handles a
// non-zero exit, so a mistake reads as a named refusal instead of a crash — and
// the refusal names the exit, which is the rule this repository states for every
// dead end.
{
  const refused = await runHelper(["artifacts", "add"], root);
  assert.equal(refused.code, 2, "an undeclared verb is refused with the helper's own usage code");
  assert.match(refused.stderr, /not a declared host verb/, "the refusal names the bug");
  assert.match(refused.stderr, /artifacts/, "the refusal names the verb that failed");
  assert.match(
    refused.stderr,
    new RegExp(HOST_HELPER_VERBS[0]),
    "the refusal names the declared set, so the reader has somewhere to go",
  );
  assert.doesNotMatch(
    refused.stderr,
    /unknown subcommand/,
    "the host refuses before spawning — bash never sees the verb",
  );
}

// A declared verb still reaches the helper and still reports the helper's own
// answer, so the funnel cannot silently swallow real calls.
{
  const real = await runHelper(["schema", "advance"], root);
  assert.equal(real.code, 0, "a declared verb runs");
  assert.match(real.stdout, /advance/, "and the helper's answer comes back unchanged");
}

console.log(
  `helper verbs test ok: ${HOST_HELPER_VERBS.length} declared verbs answered by the pin, undeclared verbs refused before spawning`,
);
