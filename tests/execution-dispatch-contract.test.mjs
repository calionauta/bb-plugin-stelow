import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const server = readFileSync(join(fileURLToPath(new URL("..", import.meta.url)), "server.ts"), "utf8");
const cliStart = server.indexOf('if (argv[0] === "advance")');
const cliEnd = server.indexOf('if (argv[0] === "gap-scopes")', cliStart);
const cli = server.slice(cliStart, cliEnd);
const routeIndex = cli.indexOf("resolveStageExecutionRoute");
const mutateIndex = cli.indexOf("runHelper(helperArgs");
const coordinatorIndex = cli.indexOf("recordCoordinatorSequentialRoute");
const nativeIndex = cli.indexOf("startNativeStageForCard");

assert.ok(cliStart >= 0 && cliEnd > cliStart, "CLI advance block exists");
assert.ok(routeIndex >= 0 && routeIndex < mutateIndex, "CLI route resolves before state mutation");
assert.ok(coordinatorIndex > mutateIndex && nativeIndex > coordinatorIndex, "coordinator route is recorded before native dispatch");
console.log("execution dispatch contract ok: route, mutation, coordinator, native order");
