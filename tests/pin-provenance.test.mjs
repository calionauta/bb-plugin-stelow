import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyPinProvenance } from "../lib/pin-provenance.mjs";

/**
 * The pin's provenance, decided by a pure function and enforced by an adapter.
 *
 * Both halves matter, for different reasons. The decision is where the rule
 * lives: a pin that is not on upstream main is a pin no upstream CI and no
 * upstream release ever blessed — which is exactly what this repository shipped
 * once (`abc51fb`, a branch tip from `fix-question-copy-verify`) while the
 * drift gate reported the tree perfectly matched. The adapter is where the
 * network seam is, and an unreachable API must fail closed, because a check
 * that skips itself when it cannot look is the check nobody was running.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts", "check-pin-provenance.mjs");

test("a pin on main's history is released; a pin off it is not", () => {
  assert.deepEqual(classifyPinProvenance({ status: "identical", behind_by: 0 }, "abc"), {
    state: "released",
    detail: "pin abc is the tip of upstream main",
  });
  // `classifyPinProvenance` reads a payload describing the PIN against main
  // (the script asks `compare/main...{pin}`), so `behind` is a pin main has
  // moved past — released. Reading the reverse direction inverted this pair.
  assert.equal(classifyPinProvenance({ status: "behind", behind_by: 3 }, "abc").state, "released");
  assert.equal(
    classifyPinProvenance({ status: "behind", behind_by: 3 }, "abc").detail,
    "pin abc is 3 commit(s) behind upstream main",
  );

  const diverged = classifyPinProvenance({ status: "diverged", behind_by: 5, ahead_by: 2 }, "abc");
  assert.equal(diverged.state, "unreleased");
  assert.match(diverged.detail, /not on upstream main \(diverged\)/);
  assert.match(diverged.detail, /Cut a release on main, then dispatch the sync/);
  assert.equal(classifyPinProvenance({ status: "ahead" }, "abc").state, "unreleased");

  assert.equal(classifyPinProvenance(null, "abc").state, "unknown");
  assert.match(classifyPinProvenance({ status: "sideways" }, "abc").detail, /Unrecognised/);
});

/** Serve the compare payload the script asks for, and nothing else. */
async function withFakeApi(handler, run) {
  const server = createServer((request, response) => handler(request, response));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/**
 * Async on purpose. `spawnSync` blocks the event loop, which is the same loop
 * this test's fake API needs to answer on — the first version of this test
 * deadlocked and had to be killed.
 */
function runScript(api) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      cwd: root,
      env: { ...process.env, STELOW_GITHUB_API: api, GITHUB_TOKEN: "" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("the script asks GitHub in the direction that describes the pin", async () => {
  const pin = JSON.parse(
    readFileSync(join(root, "data", "stelow-source.json"), "utf8"),
  ).commit;
  const asked = [];

  const released = await withFakeApi((request, response) => {
    asked.push(request.url);
    response.writeHead(200, { "content-type": "application/json" });
    // A payload describing the PIN: main has moved past it, so it is released.
    response.end(JSON.stringify({ status: "behind", behind_by: 2 }));
  }, runScript);
  assert.equal(released.status, 0, released.stderr);
  assert.match(released.stdout, /pin provenance: .* \(released\)/);
  assert.match(
    asked[0],
    new RegExp(`/compare/main\\.\\.\\.${pin}$`),
    "asks whether the pin is on main, in the direction whose status describes the pin",
  );
  assert.doesNotMatch(
    asked[0],
    new RegExp(`/compare/${pin}\\.\\.\\.main$`),
    "the reversed direction describes main instead, which inverts ahead/behind",
  );

  const stranded = await withFakeApi((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "diverged", behind_by: 3, ahead_by: 10 }));
  }, runScript);
  assert.equal(stranded.status, 1, "an off-main pin stops the run");
  assert.match(stranded.stdout, /\(unreleased\)/);
});

test("an unreachable API fails closed instead of declaring the pin fine", async () => {
  const result = await withFakeApi((request, response) => {
    response.writeHead(500, { "content-type": "application/json" });
    response.end("{}");
  }, runScript);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not reach/);
});
