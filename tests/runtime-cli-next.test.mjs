import assert from "node:assert/strict";
import test from "node:test";
import { createHelperPassthroughCommands } from "../server/runtime/cli/cli-helper-passthrough.ts";
import { cliHelpResult, stelowCliCommands } from "../server/runtime/cli-registry.ts";
import { callsNamed, cliHarness } from "./helpers/cli-harness.mjs";

/** `bb stelow next` is the worker-facing answer to "what may this card advance
 * to?". The helper does not live inside a card workspace, so the host wraps the
 * verb: these tests pin the argv it forwards, the root and state dir it resolves
 * from the card, and — the part a worker would misread — that a helper failure
 * arrives with the helper's own exit code and both streams, never as a success.
 *
 * The host-side flags stay host-side: `--project` is consumed by the wrapper and
 * never forwarded, while `--json` is the helper's flag and is forwarded verbatim,
 * because the host cannot render a machine shape it does not own. */

const CARD = { id: "card_1", dir_hash: "hash1", worker_thread_id: "thr_worker" };

/** A deps object holding only what this family reads, recording every call so
 * "was the helper even reached?" is observable instead of inferred. */
function helperDeps(options = {}) {
  const calls = { cards: [], workspaces: [], roots: [], stateDirs: [], guards: [], helper: [] };
  const card = options.card === undefined ? CARD : options.card;
  const deps = {
    getCardByWorkerThread: (threadId) => {
      calls.cards.push(threadId);
      return card && card.worker_thread_id === threadId ? card : undefined;
    },
    cardWorkspace: async (target) => {
      calls.workspaces.push(target.id);
      return { path: options.workspacePath ?? "/w" };
    },
    projectRoot: async (projectId) => {
      calls.roots.push(projectId);
      return options.projectRoot ?? "/project-root";
    },
    workflowStateDir: async (root, cardId, dirHash) => {
      calls.stateDirs.push([root, cardId, dirHash]);
      return `${root}/.stelow/state`;
    },
    ensureProjectArtifacts: async (root, stateDir, owned) => {
      calls.guards.push([root, stateDir, owned]);
      return options.guard ?? null;
    },
    runHelper: async (args, root, stateDir) => {
      calls.helper.push({ args, root, stateDir });
      return options.helper ?? { code: 0, stdout: "", stderr: "" };
    },
  };
  const commands = createHelperPassthroughCommands(deps);
  const invoke = (argv, ctx = { threadId: CARD.worker_thread_id, projectId: "proj_1" }) =>
    runFamily(commands, argv, ctx);
  return { calls, commands, deps, invoke };
}

/** The dispatcher's own walk: the first family that answers a verb owns it. */
async function runFamily(commands, argv, ctx) {
  for (const command of commands) {
    const result = await command(argv, ctx);
    if (result) return result;
  }
  return null;
}

test("next prints the helper's answer from the card's workspace and state dir", async () => {
  const { invoke, calls } = helperDeps({
    helper: { code: 0, stdout: "execution\n", stderr: "" },
  });
  const result = await invoke(["next"]);
  assert.deepEqual(
    result,
    { exitCode: 0, stdout: "execution\n", stderr: "" },
    "the helper's stdout is the answer, unmodified",
  );
  assert.deepEqual(
    calls.helper,
    [{ args: ["next"], root: "/w", stateDir: "/w/.stelow/state" }],
    "one helper run: the verb, the card workspace, the card's owned state dir",
  );
  assert.deepEqual(
    calls.cards,
    ["thr_worker"],
    "the card is resolved from the worker thread in context",
  );
});

test("next --json forwards the flag, not the host's own flags", async () => {
  const { invoke, calls } = helperDeps({
    helper: { code: 0, stdout: '{"next":[]}', stderr: "" },
  });
  const result = await invoke(["next", "--json"]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(
    calls.helper.map((call) => call.args),
    [["next", "--json"]],
    "--json is the helper's flag, so it is forwarded verbatim",
  );
});

test("next outside a card resolves --project's root and no state dir", async () => {
  const { invoke, calls } = helperDeps();
  const result = await invoke(
    ["next", "--project", "proj_x"],
    { threadId: "thr_orphan", projectId: "proj_ctx" },
  );
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls.cards, ["thr_orphan"], "the thread in context is looked up");
  assert.deepEqual(calls.workspaces, [], "a thread with no card looks up no workspace");
  assert.deepEqual(
    calls.roots,
    ["proj_x"],
    "the project named on the command line beats the context's project",
  );
  assert.deepEqual(
    calls.helper,
    [{ args: ["next"], root: "/project-root", stateDir: undefined }],
    "project-root state is never invented, and the host's --project is not forwarded",
  );
});

test("a mistyped flag refuses as usage before any work", async () => {
  const { invoke, calls } = helperDeps();
  const result = await invoke(["next", "--nope"]);
  assert.equal(result.exitCode, 2);
  assert.match(
    result.stderr,
    /Usage: bb stelow next \[--json\] \[--project <proj_id>\]/,
    "the refusal names the shape the verb accepts",
  );
  assert.deepEqual(calls.helper, [], "a mistyped flag never reaches the helper");
  assert.deepEqual(calls.cards, [], "and never resolves a card");
  assert.deepEqual(calls.roots, [], "or a project root");
});

test("a helper failure surfaces its exit code and both streams", async () => {
  const { invoke } = helperDeps({
    helper: { code: 3, stdout: "partial", stderr: "boom" },
  });
  assert.deepEqual(
    await invoke(["next"]),
    { exitCode: 3, stdout: "partial", stderr: "boom" },
    "the helper's verdict is the answer: exit 3 is neither a success nor flattened to 1",
  );
});

test("the family stays silent for a verb it does not own", async () => {
  const { commands, calls } = helperDeps();
  const result = await runFamily(commands, ["advance"], { threadId: CARD.worker_thread_id });
  assert.equal(result, null, "advance belongs to its own family; this one returns null");
  assert.deepEqual(calls.helper, []);
});

test("the real command table reaches next instead of shadowing it", async () => {
  const { invoke, calls } = cliHarness({
    helper: { code: 0, stdout: "execution", stderr: "" },
  });
  const result = await invoke(["next", "--json"]);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(
    callsNamed(calls, "helper").map(([, args]) => args),
    [["next", "--json"]],
    "a family nobody registered would answer as an unknown command",
  );
});

test("help advertises the verb the family claims", () => {
  const entry = stelowCliCommands.find((command) => command.name === "next");
  assert.ok(entry, "next is declared in the registry the help text renders from");
  const help = cliHelpResult(["help", "next"]);
  assert.equal(help.exitCode, 0, "help next answers instead of falling back to unknown command");
  assert.match(help.stdout, /bb stelow next \[--json\] \[--project <proj_id>\]/);
});
