import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = readFileSync(join(root, "server/execution-advance.ts"), "utf8");
const server = readFileSync(join(root, "server.ts"), "utf8");

const prepareStart = source.indexOf("async function prepareAdvance");
const prepareEnd = source.indexOf("async function dispatchAdvance", prepareStart);
const prepare = source.slice(prepareStart, prepareEnd);
const dispatchStart = prepareEnd;
const dispatchEnd = source.indexOf("async function applyBand", dispatchStart);
const dispatch = source.slice(dispatchStart, dispatchEnd);
const cliStart = source.indexOf("async function advanceCli");
const cli = source.slice(cliStart);

const prepareRoute = prepare.indexOf("resolveStageExecutionRoute");
const coordinator = dispatch.indexOf("recordCoordinatorSequentialRoute");
const native = dispatch.indexOf("startNativeStageForCard");
const cliPrepare = cli.indexOf("prepareAdvance");
const cliMutate = cli.indexOf("deps.runHelper(helperArgs");
const cliDispatch = cli.indexOf("dispatchAdvance");

assert.ok(prepareStart >= 0 && prepareEnd > prepareStart, "advance preflight owns a bounded module section");
assert.ok(prepareRoute >= 0, "advance preflight resolves the canonical execution route");
assert.ok(coordinator >= 0 && native > coordinator, "coordinator fallback is recorded before native dispatch");
assert.ok(cliPrepare >= 0 && cliPrepare < cliMutate && cliMutate < cliDispatch, "CLI route preflight precedes helper mutation and dispatch");
assert.match(server, /argv\[0\] === "advance"\) return executionAdvance\.cli\(argv, ctx\)/, "the thin server delegates CLI advance to the module");
console.log("execution dispatch contract ok: route, mutation, coordinator, native order");
