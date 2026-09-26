// The order an advance happens in, pinned on the seams the split created rather
// than on one file's text: the preflight must resolve the canonical route, the
// dispatch must record the coordinator fallback before it tries native, and the
// CLI must preflight before it lets the helper mutate anything. Each pin names
// the regression it catches — a rule moved back inside its neighbour, or a
// dispatch that records the fallback after the native start it was avoiding.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = (name) => readFileSync(join(root, "server", ...name.split("/")), "utf8");

const preflight = source("execution-advance-preflight.ts");
const dispatch = source("execution-advance-dispatch.ts");
const cli = source("execution-advance-cli.ts");
const advance = source("execution-advance.ts");
const runtime = [
  source("plugin-runtime.ts"),
  source("runtime/cli/cli-dispatcher.ts"),
].join("\n");

assert.match(
  preflight,
  /deps\.native\.resolveStageExecutionRoute\(input\.card, input\.stage, input\.rootPath\)/,
  "the preflight resolves the canonical execution route",
);
assert.match(
  preflight,
  /if \(scopes\.refusal\) \{[\s\S]*recordExecution\(deps, input\.card\.id, scopes\.refusal, "execution-refused"\)/,
  "a scope-gate refusal is recorded on the card before it is returned",
);

const coordinator = dispatch.indexOf("recordCoordinatorSequentialRoute");
const native = dispatch.indexOf("startNativeStageForCard");
assert.ok(coordinator >= 0 && native > coordinator, "the coordinator fallback is recorded before native dispatch");

const cliPreflight = cli.indexOf("services.prepareAdvance");
const cliMutate = cli.indexOf("deps.runHelper(helperArgs");
const cliDispatch = cli.indexOf("services.dispatchAdvance");
assert.ok(
  cliPreflight >= 0 && cliPreflight < cliMutate && cliMutate < cliDispatch,
  "the CLI route preflight precedes helper mutation and dispatch",
);
assert.match(
  advance,
  /prepareAdvance: preflight\.prepareAdvance,[\s\S]*dispatchAdvance: dispatcher\.dispatchAdvance/,
  "both entry points are wired to the one preflight and the one dispatch",
);
assert.match(
  runtime,
  /argv\[0\] === "advance"[\s\S]*deps\.advanceCli\(argv, \{ threadId: ctx\.threadId, projectId: ctx\.projectId \}\)/,
  "the CLI dispatcher delegates advance to the module through the injected contract",
);
console.log("execution dispatch contract ok: route, mutation, coordinator, native order");
