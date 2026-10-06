import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WORKER_PROTOCOL_CLAUSES } from "../server/runtime/worker-protocol-clauses.ts";

/**
 * A spawn path cannot be added without a test noticing.
 *
 * This is the structural guard behind the rendered-prompt assertions, and it
 * exists because a *declared* corpus fails silently: `prompt-contracts.test.mjs`
 * used to list the spawn sites it checked, had one entry, and stayed green while
 * four other builders drifted. A list written by hand is a promise; a directory
 * listing is a fact.
 *
 * So: every module whose name says it builds a prompt must be a module this
 * suite renders. Adding a builder without registering it fails here, which is
 * the moment somebody has to decide whether it owes the worker protocols — the
 * decision the drift skipped.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The builders whose rendered output the suite asserts on, by path. */
const RENDERED_BUILDERS = new Set([
  "server/cards-create-prompt.ts",
  "server/runtime/card-reseed-prompt.ts",
  "server/runtime/worker-restart-prompt.ts",
  "server/runtime/track-prompts.ts",
]);

/** Prompt-named modules that are deliberately not a build spawn path, each with
 * the reason. A module that joins this list has been looked at. */
const NAMED_EXCEPTIONS = new Map([
  [
    "server/runtime/start-workflow-prompt.ts",
    "the free-text workflow entry prompt — it selects a route, it does not hand a worker the card protocols",
  ],
]);

function promptNamedModules() {
  const found = [];
  for (const dir of ["server", "server/runtime"]) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      if (!entry.name.includes("prompt")) continue;
      found.push(`${dir}/${entry.name}`);
    }
  }
  return found.sort();
}

const modules = promptNamedModules();
assert.ok(modules.length >= 5, `the prompt-module scan found the builders (got ${modules.length})`);

const unaccounted = modules.filter((file) => !RENDERED_BUILDERS.has(file) && !NAMED_EXCEPTIONS.has(file));
assert.deepEqual(
  unaccounted,
  [],
  `every prompt-building module is either rendered by the suite or listed as an exception with a reason. Unaccounted: ${unaccounted.join(", ")}`,
);

const staleExceptions = [...NAMED_EXCEPTIONS.keys()].filter((file) => !modules.includes(file));
assert.deepEqual(staleExceptions, [], `a named exception whose module is gone is a stale reason: ${staleExceptions.join(", ")}`);

const staleBuilders = [...RENDERED_BUILDERS].filter((file) => !modules.includes(file));
assert.deepEqual(staleBuilders, [], `a rendered builder that no longer exists means the matrix shrank silently: ${staleBuilders.join(", ")}`);

// --- The clause bag is the one place a build clause can be added. -----------
// Every clause a *build* worker must carry belongs in the bag, because the bag
// is what each path receives. A clause that reaches only one builder has to be
// interpolated directly, and that is the shape the ask contract had before it
// was moved here — five pasted copies, two of which had drifted.
const bag = WORKER_PROTOCOL_CLAUSES;
const EXPECTED_CLAUSES = [
  "cardOwnerRules",
  "neverSeed",
  "cliEquivalents",
  "reconProtocol",
  "draftProtocol",
  "turnDiscipline",
  "commitStyle",
  "interfacePick",
  "doneProtocol",
  "splitProtocol",
  "userInputContract",
];
assert.deepEqual(
  Object.keys(bag).sort(),
  [...EXPECTED_CLAUSES].sort(),
  "the worker clause bag carries exactly the protocols a build spawn path owes — a clause added here is a clause "
    + "the rendered-prompt test starts requiring, and a clause removed here is a protocol silently dropped from every worker",
);
assert.equal(new Set(EXPECTED_CLAUSES).size, EXPECTED_CLAUSES.length, "no clause is listed twice");
for (const [name, clause] of Object.entries(bag)) {
  assert.ok(typeof clause === "string" && clause.length > 40, `${name} is a real clause, not a placeholder`);
}

// Every wiring site binds the bag rather than rebuilding it. Three literals of
// the same ten clauses under three names is how the bag stopped being the
// answer to "what does a worker get".
// A test fixture that lists the clause bag but omits a clause renders that clause
// as an empty string, which is the exact failure the rendered-prompt test exists
// for — one level up, in the tests themselves. This happened while adding the ask
// contract: four fixtures spelled the ten clauses out by hand, so the reseed
// prompt rendered an empty ask contract and a test that asserted on it failed
// with a prompt nobody could read. A fixture that declares `splitProtocol` is
// declaring the bag, so it must declare all of it.
const fixtureFiles = [
  ...readdirSync(join(root, "tests")).filter((name) => name.endsWith(".mjs")).map((name) => `tests/${name}`),
  ...readdirSync(join(root, "tests/helpers")).filter((name) => name.endsWith(".mjs")).map((name) => `tests/helpers/${name}`),
];
const incompleteFixtures = [];
for (const file of fixtureFiles) {
  const source = readFileSync(join(root, file), "utf8");
  // Only files that spell the bag out as an OBJECT LITERAL, not files that merely
  // mention the names — this file cites the clause list and would otherwise report
  // itself as an incomplete fixture. The probe is built from the clause name so
  // the probe itself does not contain the shape it looks for.
  const literal = /splitProtocol:\s*["']/.test(source);
  if (!literal) continue;
  const missing = EXPECTED_CLAUSES.filter((clause) => !new RegExp(`\\b${clause}\\s*:`).test(source));
  if (missing.length > 0) incompleteFixtures.push(`${file} (missing ${missing.join(", ")})`);
}
assert.deepEqual(
  incompleteFixtures,
  [],
  "a test fixture that spells out the protocol bag must spell out all of it, or the clause "
    + `it omits renders empty. Incomplete: ${incompleteFixtures.join("; ")}`,
);

const wiringSources = [
  "server/runtime/wiring/card-creator.ts",
  "server/runtime/wiring/gate-surfaces.ts",
  "server/runtime/worker-protocol-clauses.ts",
];
const rebuilt = wiringSources.filter((file) => {
  const source = readFileSync(join(root, file), "utf8");
  const literalClauseCount = (source.match(/cardOwnerRules:\s*[A-Z_]+/g) ?? []).length;
  return literalClauseCount > 1;
});
assert.deepEqual(
  rebuilt,
  [],
  `every wiring site binds WORKER_PROTOCOL_CLAUSES instead of rebuilding the clause object. Rebuilding: ${rebuilt.join(", ")}`,
);

console.log(`spawn path registry ok: ${modules.length} prompt modules, ${EXPECTED_CLAUSES.length} clauses in the bag`);
