import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Deferred start: creating parks, starting is explicit. Defaults stay
// today's behavior (spawn on submit); nothing in the server forces an
// unstarted card — only the human unchecks the box.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");
const app = readFileSync(join(root, "app.tsx"), "utf8");

// Deferred start: creating spawns by default, and parks only where a human
// chose it. The automation path carries the rule's autostart flag (default
// off) instead of a literal — the human opts in per rule, the server never
// assumes.
assert.match(server, /start = true/, "creation spawns by default");
assert.ok(!server.includes("start: false"), "no literal forced park anywhere — the automation path carries the rule choice");
assert.match(server, /start: rule\.autostart === 1/, "the automation path passes the rule flag, never a literal");
assert.ok(server.indexOf("start: rule.autostart") > server.indexOf("async function runAutomationRules"), "the rule choice lives inside runAutomationRules, never in a creation path");
// The flag is a real column defaulting to draft-only, a contract member,
// and an updatable field — not UI-only state that the scheduler ignores.
assert.match(server, /ADD COLUMN autostart INTEGER NOT NULL DEFAULT 0/, "existing rule rows gain autostart defaulting to draft-only");
assert.match(server, /autostart: z\.boolean\(\)/, "the rule contract carries autostart");
assert.match(server, /autostart = excluded\.autostart/, "updating a rule persists autostart");
assert.match(server, /start: z\.boolean\(\)\.default\(true\)/, "the creation RPCs accept the human choice");
assert.match(server, /startWorker: \{/, "the start trigger is a named RPC");
assert.match(server, /async startWorker\(\{ cardId \}\)/, "the handler resolves the card");
assert.match(server, /spawnFreshWorker\(cardId, "start"\)/, "starting shares the fresh-spawn body");
assert.match(server, /return spawnFreshWorker\(cardId, "restart"\)/, "restart shares the same body — one spawn, never pasted");
assert.match(server, /Drag-to-Doing on a threadless card starts it/, "dragging inbox to Doing spawns instead of lying");
assert.match(server, /thread\?\.id \?\? null/, "an unstarted card stores a null thread, never a placeholder");

// Split children are approved work: they inherit the spawn default and
// never park. The split spawn call carries no start key at all.
const splitAt = server.indexOf("Split from");
assert.notEqual(splitAt, -1, "the split executor exists");
const splitCall = server.slice(splitAt, splitAt + 1200);
assert.ok(!splitCall.includes("start"), "split children inherit start-by-default — approved work never parks");

// The dialogs offer the choice (checked by default); threadless cards
// offer Start in place of thread-bound actions. Every track offers it —
// Build included, so no track can only be created running.
assert.match(app, /function StartImmediatelyCheck/, "one checkbox component serves every creation dialog");
assert.equal((app.match(/<StartImmediatelyCheck/g) ?? []).length, 3, "build, research, and explore dialogs all offer it");
// Automation rules carry the same choice per rule (default off): an aligned
// row component, an explicit opt-in checkbox, and deletion behind the shared
// confirm dialog — never a bare immediate delete.
assert.match(app, /function AutomationRuleRow\(/, "automation rows render through one aligned component");
assert.match(app, /Start automatically/, "the new-rule form offers auto-start in the composer's wording");
assert.match(app, /unchecked parks in Inbox\./, "the default-off choice states where matches go");
assert.match(app, /Auto-start rule \$\{rule\.label\}/, "each row toggles auto-start with an accessible name");
assert.match(app, /setAutomationDeleteIds\(\[rule\.id\]\)/, "single delete opens the confirm instead of deleting");
assert.match(app, /Delete this automation rule\?/, "the confirm names the destructive rule action");
assert.equal((app.match(/<StartImmediatelyCheck/g) ?? []).length, 3, "build, research, and explore dialogs all offer it");
assert.match(app, /rpc\.call\("createCard", \{[^}]*start: startImmediately/, "build submit passes the choice");
assert.match(app, /rpc\.call\("createResearchCard", \{[^}]*start: startImmediately/, "research submit passes the choice");
assert.match(app, /rpc\.call\("createExploreCard", \{[^}]*start: startImmediately/, "explore submit passes the choice");
assert.equal((app.match(/rpc\.call\("startWorker"/g) ?? []).length, 3, "build, research, and explore cards all offer Start");
assert.match(app, /Not started — parked in Inbox/, "a parked card says plainly that nothing runs");
// The Inbox is the board's first column on every track, and leaving it is
// what starts a parked card (a build phase move spawns instead of lying).
assert.match(server, /const decision = resolveCardMove\(card\.kind, status, \{ hasWorker: Boolean\(card\.worker_thread_id\) \}\)/, "the move policy knows whether the card already started");
assert.match(server, /if \(!card\.worker_thread_id\) \{\s*const started = await spawnFreshWorker\(cardId, "start"\);/, "entering a build phase starts a parked card");
assert.match(server, /updateCard\(cardId, previous\)/, "a failed start reverts the phase instead of parking a lie");
assert.match(app, /function boardColumnOf\(card: Pick<CardItem, "status" \| "stage" \| "workerThreadId">\)/, "the board projection keeps thread state, so a parked card reaches the Inbox");

// Leaving the Inbox starts through the same starter on every track, and the
// starter resolves creation-time choices: the pinned preset override
// (provider/model) and the card's own project workspace — never ambient defaults.
assert.match(server, /const effective = getPresetForBand\(/, "Inbox exits spawn through the override-aware preset resolution");
assert.match(server, /SELECT preset_id FROM card_presets WHERE card_id/, "a choice pinned at creation wins over band defaults at spawn");
assert.match(server, /const workspace = await cardWorkspace\(row\);/, "respawns run in the card's own project workspace");
assert.match(server, /if \(decision\.move\.status === "in-progress" && !card\.worker_thread_id\)/, "dragging a lightweight card to Doing starts it too");

// A Build workflow is code work: a Personal/exploratory folder only holds
// Stelow state and cannot truthfully produce a diff, branch, or commit.
assert.match(server, /Build cards require a project workspace with a Git source/, "new Build cards refuse an exploratory workspace");
assert.match(server, /Cannot split a Build workflow from an exploratory workspace/, "split cannot recreate an unverifiable Build child");
assert.match(server, /auditReceiptReadiness\(receiptContent/, "Build done checks the durable audit receipt before becoming Done");

console.log("card start test ok: deferred start, shared spawn, split always starts");
