import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");
const app = readFileSync(join(root, "app.tsx"), "utf8");

function rpcMethod(name, nextName) {
  const start = server.indexOf(`    async ${name}(`);
  const end = server.indexOf(`    async ${nextName}(`, start + 1);
  assert.notEqual(start, -1, `${name} RPC exists`);
  assert.notEqual(end, -1, `${nextName} RPC marks the end of ${name}`);
  return server.slice(start, end);
}

function appFunction(name, nextMarker) {
  const start = app.indexOf(`function ${name}(`);
  const end = app.indexOf(nextMarker, start + 1);
  assert.notEqual(start, -1, `${name} UI function exists`);
  assert.notEqual(end, -1, `${nextMarker} marks the end of ${name}`);
  return app.slice(start, end);
}

const updateIntent = rpcMethod("updateCardIntent", "addCardComment");
assert.match(updateIntent, /if \(!canEditWorkflowIntent\(card\)\)/, "only triage Build cards can edit their workflow type");
assert.doesNotMatch(updateIntent, /threads\.send\(/, "editing type never silently redirects an existing worker");

const reseed = rpcMethod("reseedCard", "moveCard");
assert.match(reseed, /resolveReseedIntent\(card, requestedIntent\)/, "fresh restarts are the only route reclassification path");
assert.match(reseed, /freshStatusForReseed\(card, reclassified\)/, "reclassification reopens the card at a coherent status");
assert.match(reseed, /publish\("card-state", \{ cardId \}\)/, "reclassification refreshes open card surfaces");

const archive = rpcMethod("cancelCard", "deleteCard");
assert.match(archive, /publish\("card-state", \{ cardId \}\)/, "archive refreshes open card surfaces");
assert.match(archive, /publish\("board-changed", \{ cardId \}\)/, "archive refreshes board surfaces");

const remove = rpcMethod("deleteCard", "retryWorker");
assert.match(remove, /publish\("card-state", \{ cardId \}\)/, "delete refreshes open card surfaces");
assert.match(remove, /publish\("board-changed", \{ cardId \}\)/, "delete refreshes board surfaces");

assert.match(app, /workerSectionPolicy\(card, Boolean\(detail\?\.card\.needsAttention\), \{ hasGithubLink, historyCount: detail\?\.workerHistory\.length \?\? 0 \}\)/, "Worker visibility comes from the shared policy");
assert.match(app, /archivedCardDetailPresentation\(card, stageLabel\)/, "archived hero and workflow copy come from one presentation policy");

const header = appFunction("CardDetailHeader", "// Status rank");
assert.match(header, /canEditWorkflowIntent\(card\)/, "the header delegates type editability to the shared policy");
assert.match(header, /<CardActionsMenu/, "card lifecycle affordances live in the header");

const menu = appFunction("CardActionsMenu", "function CardDetailHeader");
assert.match(menu, /Archive card…/, "archive remains its own explicit action");
assert.match(menu, /Delete permanently…/, "permanent deletion remains its own explicit action");
assert.doesNotMatch(menu, /Stop & archive/, "two distinct lifecycle actions are never conflated");

const worker = appFunction("WorkerSection", "// Research-track card detail");
assert.doesNotMatch(worker, /Archive card|Delete permanently|Restart fresh/, "Worker contains worker context only, never card lifecycle actions");

// Archived is terminal: the single updateCard choke point strips
// resuscitations, worker-thread events never reach archived cards, and the
// Archive button honors a refused archive instead of celebrating it.
assert.match(server, /stripArchivedResuscitation\(previous\?\.status, fields/, "every status write passes the archived-terminal rule");
const idleHandler = server.slice(server.indexOf('bb.events.on("thread.idle"'), server.indexOf('bb.events.on("thread.active"'));
const activeHandler = server.slice(server.indexOf('bb.events.on("thread.active"'), server.indexOf('bb.events.on("thread.failed"'));
const failedHandler = server.slice(server.indexOf('bb.events.on("thread.failed"'), server.indexOf("// Reconcile card states"));
for (const [name, handler] of [["idle", idleHandler], ["active", activeHandler], ["failed", failedHandler]]) {
  assert.match(handler, /status != 'archived'/, `thread.${name} events never sync archived cards`);
}
const doArchive = appFunction("doArchive", "async function doDelete");
assert.match(doArchive, /if \(!result\.archived\)/, "a refused archive surfaces an error instead of a false success");

console.log("card lifecycle contract test ok: UI and RPC keep card lifecycle semantics aligned");
