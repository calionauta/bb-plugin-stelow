import assert from "node:assert/strict";
import test from "node:test";
import { workflowsDependencyStatus, workflowsUnreadable } from "../lib/workflow-dependency-status.mjs";
import { createWorkflowDependencyHandlers } from "../server/runtime/workflow-dependency.ts";

function listJson(row) {
  return JSON.stringify([{ id: "other", enabled: true, status: "running" }, row]);
}

/** A host CLI stub: the list payload plus a per-args install/enable verdict. */
function cliHost({ listed, verdicts = {}, failure = { code: 0, stdout: "", stderr: "" } }) {
  const calls = [];
  return {
    calls,
    runCli: async (args) => {
      calls.push(args.join(" "));
      const joined = args.join(" ");
      if (joined.includes("plugin list")) return listed;
      return verdicts[args.slice(0, 2).join(" ")] ?? failure;
    },
  };
}

test("a missing plugin row asks for an install, not an enable", () => {
  const status = workflowsDependencyStatus(listJson(undefined).replace("undefined", "null"));
  assert.equal(status.installed, false);
  assert.equal(status.action, "install");
  assert.equal(status.available, false);
  assert.match(status.detail, /^Install BB Workflows/);
});

test("installed, enabled, and running is the only available state", () => {
  const ready = workflowsDependencyStatus(listJson({ id: "workflows", enabled: true, status: "running", version: "1.2.0" }));
  assert.equal(ready.available, true);
  assert.equal(ready.action, null);
  assert.equal(ready.version, "1.2.0");
  assert.match(ready.detail, /installed, enabled, and ready/);

  const starting = workflowsDependencyStatus(listJson({ id: "workflows", enabled: true, status: "stopped" }));
  assert.equal(starting.available, false, "enabled but not running is not available");
  assert.equal(starting.action, null, "nothing left to configure while it starts");
  assert.match(starting.detail, /still starting it/);

  const disabled = workflowsDependencyStatus(listJson({ id: "workflows", enabled: false, status: "stopped" }));
  assert.equal(disabled.action, "enable");
  assert.match(disabled.detail, /^Enable BB Workflows/);
});

test("the wrapped list shape and a missing version are read the same way", () => {
  const wrapped = workflowsDependencyStatus(JSON.stringify({ plugins: [{ id: "workflows", enabled: true, status: "running" }] }));
  assert.equal(wrapped.available, true);
  assert.equal(wrapped.version, null, "a host that reports no version reports null, not undefined");

  const absent = workflowsDependencyStatus(JSON.stringify({ plugins: [] }));
  assert.equal(absent.action, "install");
  assert.throws(() => workflowsDependencyStatus("not json"), "unreadable output throws so the caller can name the reason");
});

test("an unreadable host keeps the install action and the host's own words", () => {
  assert.match(workflowsUnreadable().detail, /could not be read/);
  assert.match(workflowsUnreadable("bb: command not found").detail, /command not found/);
  assert.equal(workflowsUnreadable("").detail, "BB Workflows status could not be read.");
});

test("a failed read never throws and never claims the dependency is available", async () => {
  const host = cliHost({ listed: { code: 1, stdout: "", stderr: "bb: host offline" } });
  const status = await createWorkflowDependencyHandlers(host).workflowDependencyStatus();
  assert.equal(status.available, false);
  assert.equal(status.action, "install");
  assert.equal(status.detail, "bb: host offline");
  assert.deepEqual(host.calls, ["plugin list --json"]);
});

test("a malformed list is reported, not thrown at the UI", async () => {
  const host = cliHost({ listed: { code: 0, stdout: "<html>gateway</html>", stderr: "" } });
  const status = await createWorkflowDependencyHandlers(host).workflowDependencyStatus();
  assert.equal(status.action, "install");
  assert.ok(status.detail.length > 0, "the parse failure names itself in the card");
});

test("install and enable re-read the host and report the settled state", async () => {
  const host = cliHost({
    listed: { code: 0, stdout: listJson({ id: "workflows", enabled: true, status: "running" }), stderr: "" },
    verdicts: { "plugin install": { code: 0, stdout: "", stderr: "" } },
    failure: { code: 1, stdout: "", stderr: "plugin enable refused" },
  });
  const handlers = createWorkflowDependencyHandlers(host);

  const installed = await handlers.installWorkflowDependency();
  assert.equal(installed.ok, true);
  assert.equal(installed.error, null);
  assert.equal(installed.status.available, true);
  assert.deepEqual(host.calls, [
    "plugin install builtin:workflows --yes --json",
    "plugin list --json",
  ]);

  const enabled = await handlers.enableWorkflowDependency();
  assert.equal(enabled.ok, false, "a refusal is not swallowed by a healthy-looking status");
  assert.equal(enabled.error, "plugin enable refused");
  assert.deepEqual(host.calls.slice(2), ["plugin enable workflows --json", "plugin list --json"]);
});

test("a command that succeeds without settling the dependency is still a refusal", async () => {
  const host = cliHost({
    listed: { code: 0, stdout: listJson(undefined).replace("undefined", "null"), stderr: "" },
    verdicts: { "plugin install": { code: 0, stdout: "", stderr: "" } },
  });
  const outcome = await createWorkflowDependencyHandlers(host).installWorkflowDependency();
  assert.equal(outcome.ok, false, "exit 0 plus a host without the plugin is not an install");
  assert.equal(outcome.error, null);
  assert.equal(outcome.status.action, "install", "the card keeps offering the real next step");
});

console.log("workflow dependency ok: status derivation and explicit setup actions");
