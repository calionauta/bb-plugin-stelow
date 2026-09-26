import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "node:fs";

// The answering doors: one live interaction, one persisted recovery row. Both
// consume the same ask contract, record the same trail, mark the same inbox
// event, and clear the same stale failure — and both are reached by the RPC
// contract AND the `bb stelow answer` verb. A second copy of either door is how
// the two drifted before, so the topology is pinned: which module owns them,
// and which two surfaces bind them.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const doors = read("server/runtime/question-answers.ts");
const rpcSurfaces = read("server/runtime/wiring/rpc-surfaces.ts");
const cliSurfaces = read("server/runtime/wiring/cli-surfaces.ts");
const answerCommand = read("server/runtime/cli/cli-answer.ts");

// One owner. Two doors, one module, one factory: a door implemented anywhere
// else is a door whose recording rule will drift from the other one's.
const definitions = (source, name) => source.match(new RegExp(`(async )?function ${name}\\(`, "g")) ?? [];
assert.equal(definitions(doors, "answerQuestions").length, 1, "the live door is defined exactly once");
assert.equal(definitions(doors, "answerExpiredQuestions").length, 1, "the recovery door is defined exactly once");
assert.equal(definitions(doors, "recordContractAnswers").length, 1, "one recording rule serves both doors");
const otherOwners = globSync("server/**/*.ts", { cwd: root })
  .filter((path) => path !== "server/runtime/question-answers.ts")
  .filter((path) => /async function answerQuestions\(|async function answerExpiredQuestions\(/.test(read(path)));
assert.deepEqual(otherOwners, [], "no other module re-implements an answering door");

// Both surfaces bind the same door the card form uses. The CLI takes its doors
// as a parameter rather than owning them; a verb with its own copy of the
// recording rule is the regression this guards.
assert.match(
  rpcSurfaces,
  /answerQuestions: gates\.answerQuestions,/,
  "the RPC contract answers through the shared live door",
);
assert.match(
  rpcSurfaces,
  /answerExpiredQuestions: gates\.answerExpiredQuestions,/,
  "the RPC contract answers through the shared recovery door",
);
assert.match(
  cliSurfaces,
  /answerQuestions: deps\.gates\.answerQuestions,/,
  "the CLI verb answers through the same live door as the card",
);
assert.match(
  cliSurfaces,
  /answerExpiredQuestions: deps\.gates\.answerExpiredQuestions,/,
  "the CLI verb answers through the same recovery door as the card",
);
assert.match(answerCommand, /doors\.answerQuestions\(/, "the verb calls the injected live door");
assert.match(answerCommand, /doors\.answerExpiredQuestions\(/, "the verb calls the injected recovery door");

// The refusals both doors still own, and the exits they name.
assert.match(doors, /if \(deps\.isArchivedCard\(card\)\) return refusal\(deps\.errors\.cardArchived\);/, "archived cards refuse live answers");
assert.match(doors, /if \(deps\.isArchivedCard\(card\)\) return refusal\(deps\.errors\.cardArchived\);/, "archived cards refuse recovery answers");
assert.match(doors, /if \(rows\.length === openRows\.length\)|partialBatchRefusal/, "a partial recovery batch is refused before the worker resumes");
assert.match(doors, /Still open: \$\{stillOpen\.join\(", "\)\}/, "the partial-batch refusal names exactly which questions are still open");

// The shared recording rule: every answer leaves a trail, and a declared
// contract is named in it. `doesNotMatch` on the inlined patch is the pin — the
// drift being guarded was the card patch pasted once per door.
assert.match(doors, /answerCommentBody\(/, "answers are recorded through the shared trail rule");
assert.match(doors, /answeredCardPatch\(/, "both doors apply the shared answer card patch");
assert.doesNotMatch(
  doors,
  /status: "in-progress",\s*\n?\s*last_error: null/,
  "the answer card patch is decided once in lib/, not pasted per door",
);

console.log("answer door contract test ok: one door per module, one trail rule, two doors bound to both surfaces");
