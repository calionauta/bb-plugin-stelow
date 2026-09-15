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

assert.match(server, /start = true/, "creation spawns by default");
assert.equal((server.match(/start: false/g) ?? []).length, 0, "nothing forces an unstarted card — only the dialog variable");
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
// offer Start in place of thread-bound actions.
assert.match(app, /function StartImmediatelyCheck/, "one checkbox component serves both creation dialogs");
assert.equal((app.match(/<StartImmediatelyCheck/g) ?? []).length, 2, "research and explore dialogs both offer it");
assert.match(app, /rpc\.call\("createResearchCard", \{[^}]*start: startImmediately/, "research submit passes the choice");
assert.match(app, /rpc\.call\("createExploreCard", \{[^}]*start: startImmediately/, "explore submit passes the choice");
assert.equal((app.match(/rpc\.call\("startWorker"/g) ?? []).length, 2, "research and explore cards both offer Start");
assert.match(app, /Not started — parked in To-Do/, "a parked card says plainly that nothing runs");

// A Build workflow is code work: a Personal/exploratory folder only holds
// Stelow state and cannot truthfully produce a diff, branch, or commit.
assert.match(server, /Build cards require a project workspace with a Git source/, "new Build cards refuse an exploratory workspace");
assert.match(server, /Cannot split a Build workflow from an exploratory workspace/, "split cannot recreate an unverifiable Build child");
assert.match(server, /auditReceiptReadiness\(receiptContent/, "Build done checks the durable audit receipt before becoming Done");

console.log("card start test ok: deferred start, shared spawn, split always starts");
