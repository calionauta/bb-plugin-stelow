import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ownsWorkflowState, stateWorkflowId, upsertWorkflowEntry, workflowDirHash, workflowEntryForOwner, workflowIdForName, workflowStateRelativeDir } from "../lib/workflow-state-identity.mjs";

const oldSameName = { name: "jogo-da-velha", dirHash: "pw-old", created: "2026-09-04T17:14:57.065Z" };
const firstCard = { workflowId: "card_first", name: "jogo-da-velha", dirHash: "pw-first", created: "2026-09-12T20:00:00.000Z" };
const secondCard = { workflowId: "card_second", name: "jogo-da-velha", dirHash: "pw-second", created: "2026-09-12T20:01:00.000Z" };

// A legacy name-only row is intentionally unclaimable: guessing is how cards
// used to inherit each other's state.
assert.equal(workflowEntryForOwner([oldSameName], "card_first"), null);

const afterFirst = upsertWorkflowEntry([oldSameName], firstCard);
const afterSecond = upsertWorkflowEntry(afterFirst, secondCard);
assert.equal(afterSecond.length, 3, "same-name cards coexist instead of replacing each other");
assert.equal(workflowEntryForOwner(afterSecond, "card_first", "pw-first"), firstCard);
assert.equal(workflowEntryForOwner(afterSecond, "card_second", "pw-second"), secondCard);
assert.equal(workflowEntryForOwner(afterSecond, "card_second", "pw-first"), null, "dir hashes cannot cross owners");
assert.equal(workflowStateRelativeDir(firstCard), ".stelow/2026-09-12/pw-first");
assert.equal(workflowDirHash("card_first", false, 1), "pw-card_first");
assert.equal(workflowDirHash("card_first", true, 36), "pw-card_first-10");
assert.notEqual(workflowDirHash("card_first"), workflowDirHash("card_second"), "different cards have different state directories");

const firstState = "---\nworkflow_id: card_first\nname: jogo-da-velha\ncurrent_stage: triage\n---\n";
assert.equal(stateWorkflowId(firstState), "card_first");
assert.equal(ownsWorkflowState(firstState, "card_first"), true);
assert.equal(ownsWorkflowState(firstState, "card_second"), false, "a state file never belongs to a same-name card");

const updatedFirst = { ...firstCard, dirHash: "pw-reseed" };
const afterReseed = upsertWorkflowEntry(afterSecond, updatedFirst);
assert.equal(afterReseed.length, 3, "reseed replaces only the same owner");
assert.equal(workflowEntryForOwner(afterReseed, "card_first", "pw-reseed")?.dirHash, "pw-reseed");

// Seeding by name is idempotent: the same name yields the same owner, so a
// second seed reuses one entry and one directory instead of adding a twin.
assert.equal(workflowIdForName("Auth refactor"), "wf-auth-refactor");
assert.equal(workflowIdForName("  auth  refactor "), workflowIdForName("Auth refactor"), "the same name always yields the same owner");
assert.notEqual(workflowIdForName("auth"), workflowIdForName("auth-2"), "different names stay different workflows");
assert.match(workflowIdForName("!!!"), /^wf-[a-z]/, "an unsluggable name still yields an owner");

// A re-seed keeps the workflow's first `created`: the state path
// (.stelow/<created>/<dirHash>) must never move, or it strands the old dir.
const reseededLater = upsertWorkflowEntry(afterSecond, { ...firstCard, dirHash: "pw-second-gen", created: "2026-10-01T00:00:00.000Z" });
const keptEntry = workflowEntryForOwner(reseededLater, "card_first");
assert.equal(keptEntry?.created, firstCard.created, "a re-seed keeps the first created date");
assert.equal(workflowStateRelativeDir(keptEntry), ".stelow/2026-09-12/pw-second-gen", "the state dir stays under the original date");

// Server contract: a third same-name card reads no scopes — the same rule that
// keeps state.md apart applies to the board's scope progress.
assert.equal(workflowEntryForOwner([firstCard, secondCard], "card_third"), null, "an unknown owner reads no scopes");
const serverSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server.ts"), "utf8");
const scopeReads = [...serverSource.matchAll(/(?<!function )loadCardScopes\(([^)]*)\)/g)].map((match) => match[1].trim());
assert.ok(scopeReads.length > 0, "the card-scope read sites are covered by this contract");
for (const args of scopeReads) {
  assert.match(args, /\.id$/, `card scopes resolve by owner id, got loadCardScopes(${args})`);
}

// Server contract: whatever seeds, seeds an owner. Card work binds the card id;
// human-seeded work derives a stable owner from its name. A freshly minted id
// here is how a second, unresolvable state directory gets created.
const seedOwners = [...serverSource.matchAll(/seedWorkflow\(bb, [^,]+, ([^,]+),/g)].map((match) => match[1].trim());
assert.ok(seedOwners.length >= 4, "every seed call site is covered by this contract");
for (const owner of seedOwners) {
  assert.ok(
    /(\.id|Id)$/.test(owner) || owner.startsWith("workflowIdForName("),
    `seeding binds an owner, got seedWorkflow(bb, rootPath, ${owner}, ...)`,
  );
}

// Server contract: the seed writes the state path through the resolver that
// readers use, keeps the workflow's first `created`, and re-seeds by returning
// the existing directory — never by deriving a path of its own or adding a twin.
assert.match(serverSource, /workflowStateRelativeDir\(\{ created, dirHash \}\)/, "the seed derives its state dir through the same resolver readers use");
assert.match(serverSource, /if \(reusable && entryDir\)/, "re-seeding an owned workflow is a no-op");
assert.ok(!/const date = new Date\(\)\.toISOString\(\)\.slice/.test(serverSource), "the seed no longer derives the path date segment itself");

console.log("workflow state identity test ok: immutable owner, owner-bound seeding, stable state path, idempotent re-seed, owner-only scope reads");
