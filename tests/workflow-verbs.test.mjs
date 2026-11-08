import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  HELPER_VERBS,
  HOST_WORKFLOW_VERBS,
  WORKFLOW_VERBS,
  internalVerbReason,
} from "../lib/workflow-verbs.mjs";
import { HOST_HELPER_VERBS } from "../lib/helper-verbs.mjs";
import { stelowCliCommands } from "../server/runtime/cli-registry.ts";

/**
 * One table decides how an upstream verb reaches the host.
 *
 * The failure this guards has already shipped twice. `next` was in the skills
 * and absent from the host, so a worker ran `bb stelow next` and ate a refusal.
 * `decide` worked but appeared in no help text, so nobody found it and the
 * decision path was reached by guessing. And `artifacts add` reached the pinned
 * helper for a cycle because the allow-list and the helper's dispatcher were
 * separate lists that nobody compared.
 *
 * So the assertions here are about agreement, not about this file's taste:
 *
 *   1. UPSTREAM — every verb the pinned helper advertises has a classification.
 *      A verb nobody classified is a verb the host cannot answer, and the prompt
 *      then invites a guess instead of naming the door.
 *   2. SURFACE — every host command named here is declared in the registry the
 *      help text renders from, and the two derived lists (worker-facing verbs,
 *      helper-gated verbs) are exactly the entries they claim to be. A command
 *      that exists but is not advertised is the `decide` bug; an advertised
 *      command with no implementation is its mirror image.
 *   3. INTERNAL — a verb with no worker-facing command carries a reason and no
 *      host name, and there is exactly one. The set is asserted so that adding
 *      a second internal verb is a deliberate edit, not an accident of silence.
 *   4. GATE — the helper allow-list is the helper surface, so a host-owned verb
 *      (`ask`, `decide`, `seed`, `status`) can never leak into a spawn.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const helper = join(root, "data", "stelow");
const SURFACES = new Set(["helper", "host", "internal"]);

/** The verbs the pinned helper prints in its usage block. `--help` is the flag
 * line, not a verb, and the banner's slash-separated list is not parsed: the
 * usage lines are the shapes the helper promises to answer. */
function upstreamVerbs() {
  const run = spawnSync("bash", [helper, "--help"], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, `the pinned helper answers --help: ${run.stderr ?? ""}`);
  const verbs = new Set();
  for (const line of run.stdout.split("\n")) {
    const usage = line.match(/^\s*stelow (\S+)/);
    if (!usage || usage[1] === "--help") continue;
    if (!/^[a-z][a-z-]*$/.test(usage[1])) continue;
    verbs.add(usage[1]);
  }
  return verbs;
}

test("every verb the pinned helper advertises is classified", () => {
  const upstream = upstreamVerbs();
  assert.ok(upstream.size >= 10, `the usage block parsed into verbs: ${[...upstream].join(", ")}`);
  assert.ok(upstream.has("audit-trail"), "a newly wrapped verb is visible in the usage block");
  assert.ok(upstream.has("guard-judge"), "the internal verb is in the upstream set");
  const missing = [...upstream].filter((verb) => !(verb in WORKFLOW_VERBS));
  assert.deepEqual(
    missing,
    [],
    `upstream verbs with no classification (add them to lib/workflow-verbs.mjs): ${missing.join(", ")}`,
  );
});

test("every classification is a known surface with an advertised host command", () => {
  const advertised = new Set(stelowCliCommands.map((command) => command.name));
  for (const [verb, entry] of Object.entries(WORKFLOW_VERBS)) {
    assert.ok(
      SURFACES.has(entry.surface),
      `${verb}: surface '${entry.surface}' is not one of helper|host|internal`,
    );
    if (entry.host === null) continue;
    assert.ok(
      advertised.has(entry.host),
      `${verb}: host command '${entry.host}' is not declared in stelowCliCommands, so help cannot name it`,
    );
  }
  const withHost = Object.entries(WORKFLOW_VERBS)
    .filter(([, entry]) => entry.host !== null)
    .map(([verb]) => verb);
  assert.deepEqual(
    HOST_WORKFLOW_VERBS,
    withHost,
    "HOST_WORKFLOW_VERBS is every entry with a host, in declaration order",
  );
  const helperSurface = Object.entries(WORKFLOW_VERBS)
    .filter(([, entry]) => entry.surface === "helper")
    .map(([verb]) => verb);
  assert.deepEqual(
    HELPER_VERBS,
    helperSurface,
    "HELPER_VERBS is exactly the helper surface, in declaration order",
  );
});

test("an internal verb has no host command and says why", () => {
  const internal = Object.entries(WORKFLOW_VERBS)
    .filter(([, entry]) => entry.surface === "internal")
    .map(([verb]) => verb);
  assert.deepEqual(
    internal,
    ["guard-judge"],
    "guard-judge is the only internal verb; adding another is a deliberate decision",
  );
  for (const verb of internal) {
    assert.equal(WORKFLOW_VERBS[verb].host, null, `${verb}: an internal verb cannot name a command`);
    const reason = internalVerbReason(verb);
    assert.ok(
      typeof reason === "string" && reason.trim().length > 0,
      `${verb}: an internal verb owes the reader a reason, not silence`,
    );
  }
  assert.equal(
    internalVerbReason("advance"),
    null,
    "a verb with a worker-facing command has no 'why not' reason",
  );
  assert.equal(internalVerbReason("no-such-verb"), null, "an unknown verb is not internal either");
});

test("the helper gate is exactly the helper surface", () => {
  assert.deepEqual(
    HOST_HELPER_VERBS,
    HELPER_VERBS,
    "the allow-list and the table are one list; drift is a spawn the host refuses",
  );
  for (const verb of ["ask", "decide", "seed", "status", "guard-judge"]) {
    assert.ok(
      !HOST_HELPER_VERBS.includes(verb),
      `${verb} is host-owned or internal and must never reach the helper gate`,
    );
  }
});
