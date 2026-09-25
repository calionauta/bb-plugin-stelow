import assert from "node:assert/strict";
import test from "node:test";
import { buildCard, callsNamed, cliHarness, firstCall } from "./helpers/cli-harness.mjs";

/** The dispatcher contract: which family owns which verb, what an unknown
 * verb says, and that help stays with the registry. */

test("the dispatcher answers each verb from exactly one family", async () => {
  const { invoke, calls } = cliHarness();
  assert.equal((await invoke(["metrics", "--card", "card_1"])).exitCode, 0);
  assert.equal(
    (await invoke(["manifest", "--card", "card_1"])).exitCode,
    0,
    "manifest reads the card state",
  );
  assert.equal((await invoke(["advance", "execution"])).exitCode, 0);
  assert.equal((await invoke(["scope", "start", "--scope", "scope-1"])).exitCode, 0);
  assert.deepEqual(
    callsNamed(calls, "advance").length,
    1,
    "advance reaches the module through the injected contract",
  );
  assert.deepEqual(
    callsNamed(calls, "scopeCommand").length,
    1,
    "scope reaches the scope module through the injected contract",
  );
});

test("a family stays silent for a verb it does not own", async () => {
  const { invoke, calls } = cliHarness();
  // A metrics harness must not touch the bundle, the lock registry, or the
  // preset pool: each family claims its own verb and nothing else.
  await invoke(["metrics", "--card", "card_1"]);
  assert.deepEqual(callsNamed(calls, "helper"), []);
  assert.deepEqual(callsNamed(calls, "spawnDisposable"), []);
});

test("an unknown verb suggests the nearest declared command", async () => {
  const { invoke } = cliHarness();
  const result = await invoke(["don"], { threadId: null });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /done/);
  assert.match(result.stderr, /Did you mean/);
});

test("inspection answers before any command family", async () => {
  const { invoke, calls } = cliHarness({
    inspection: { exitCode: 0, stdout: "board" },
  });
  assert.deepEqual(await invoke(["status"]), { exitCode: 0, stdout: "board" });
  assert.deepEqual(callsNamed(calls, "inspection").length, 1);
  assert.deepEqual(
    callsNamed(calls, "helper"),
    [],
    "a verb the inspector claimed never reaches a command family",
  );
});

test("a mistyped flag refuses as usage instead of reading as unset", async () => {
  const { invoke } = cliHarness();
  const result = await invoke(["metrics", "--cards", "card_1"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Usage: bb stelow metrics/);
});

test("card-scoped verbs refuse a missing card before any side effect", async () => {
  const { invoke, calls } = cliHarness();
  const noContext = await invoke(["manifest"], { threadId: null });
  assert.equal(noContext.exitCode, 2);
  assert.match(noContext.stderr, /No card in context/);
  const unknown = await invoke(["manifest", "--card", "card_nope"], { threadId: null });
  assert.equal(unknown.exitCode, 2);
  assert.match(unknown.stderr, /Unknown card "card_nope"/);
  assert.deepEqual(
    callsNamed(calls, "read"),
    [],
    "no workspace read happens for a card that does not exist",
  );
});

test("a card-scoped verb takes --card over the worker thread's own card", async () => {
  const { invoke, deps } = cliHarness();
  const result = await invoke(["manifest", "--card", "card_1"], { threadId: null });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Card not found|Manifest for/);
  assert.ok(deps.getCard("card_1"));
});

test("manifest names the registered artifacts and the paste-ready trailer", async () => {
  const state = [
    "---",
    "name: workflow",
    "artifacts:",
    "  - stage: plan",
    "    kind: document",
    "    label: tech plan",
    "    path: spec-tech.md",
    "---",
    "",
  ].join("\n");
  const { invoke } = cliHarness({
    files: { "/w/.stelow/state/state.md": state },
  });
  const result = await invoke(["manifest"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Manifest for checkout \(card_1\)/);
  assert.match(result.stdout, /Stelow-Artifacts: 1/);
  assert.match(result.stdout, /spec-tech\.md/);
});

test("done refuses an archived card by name", async () => {
  const card = buildCard({ status: "archived" });
  const { invoke, calls } = cliHarness({ card });
  const result = await invoke(["done"]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "This card is archived.");
  assert.deepEqual(
    callsNamed(calls, "updateCard"),
    [],
    "an archived card is never completed",
  );
});

test("done on a research card without a passing verify refuses with the report", async () => {
  const card = buildCard({ kind: "research" });
  const { invoke, calls } = cliHarness({
    card,
    readiness: { ready: false, fingerprint: "fp1", evidence: "verified", invalid: [] },
    strategyRounds: [{ id: "r1", at: "2026-01-01", file: "round-1.md" }],
  });
  const result = await invoke(["done"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /verify|research/i);
  assert.deepEqual(
    callsNamed(calls, "updateCard"),
    [],
    "a failed verify never completes the card",
  );
  assert.deepEqual(callsNamed(calls, "releaseClaims"), []);
});

test("done completes a research card, releases its claims, and announces it once", async () => {
  const card = buildCard({ kind: "research" });
  const { invoke, calls } = cliHarness({
    card,
    readiness: { ready: true, fingerprint: "fp1", evidence: "verified", invalid: [] },
    strategyRounds: [{ id: "r1", at: "2026-01-01", file: "round-1.md" }],
  });
  const result = await invoke(["done"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Done\. Research "checkout" completed/);
  assert.deepEqual(
    callsNamed(calls, "updateCard").map(([, , fields]) => fields.status),
    ["completed"],
  );
  assert.deepEqual(callsNamed(calls, "stage").map(([, , stage]) => stage), ["done"]);
  assert.equal(callsNamed(calls, "releaseClaims").length, 1);
  const inbox = callsNamed(calls, "inbox");
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0][4], `completed:${card.id}:index:fp1`);
});

test("a required review policy refuses done with the review redirect", async () => {
  const card = buildCard({ kind: "research" });
  const { invoke, calls } = cliHarness({
    card,
    reviewPolicy: "required",
    reviewCovers: false,
    readiness: { ready: true, fingerprint: "fp1", evidence: "verified", invalid: [] },
  });
  const result = await invoke(["done"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /run `bb stelow review`/);
  assert.deepEqual(callsNamed(calls, "updateCard"), []);
});

test("a passing review under a required policy lets done through", async () => {
  const card = buildCard({ kind: "research" });
  const { invoke, calls } = cliHarness({
    card,
    reviewPolicy: "required",
    reviewCovers: true,
    readiness: { ready: true, fingerprint: "fp1", evidence: "verified", invalid: [] },
  });
  assert.equal((await invoke(["done"])).exitCode, 0);
  assert.equal(callsNamed(calls, "updateCard").length, 1);
});

test("a build done that lost its Git evidence refuses before completing", async () => {
  const { invoke, calls } = cliHarness({
    gitEvidence: { isGit: false, gitRoot: null, branch: null, headSha: null },
    files: { "/w/.stelow/state/state.md": "current_stage: audit\n" },
  });
  const result = await invoke(["done"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /no longer has verifiable Git root and HEAD evidence/);
  assert.deepEqual(callsNamed(calls, "updateCard"), []);
});

test("a build done with an unknown card kind never guesses a completion", async () => {
  const card = buildCard({ kind: "somethingelse" });
  const { invoke, calls } = cliHarness({ card });
  const result = await invoke(["done"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Unknown card kind "somethingelse"/);
  assert.deepEqual(callsNamed(calls, "updateCard"), []);
});

test("split refuses a card with no proposal and names the ask that opens one", async () => {
  const { invoke, calls } = cliHarness({ stage: "triage" });
  const result = await invoke(["split"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /No split proposal on this card/);
  assert.match(result.stderr, /--tag split/);
  assert.deepEqual(
    callsNamed(calls, "createCard"),
    [],
    "no child card is created without an approved proposal",
  );
});

test("split past the split point refuses through the shared gate", async () => {
  const { invoke } = cliHarness({ stage: "execution" });
  const result = await invoke(["split"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /split point|triage/i);
});

test("a worker thread cannot rewrite the shared preset pool", async () => {
  const { invoke, calls } = cliHarness();
  const result = await invoke(["preset", "add", "--name", "x"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /managed from the card's Agent preset section/);
  assert.deepEqual(callsNamed(calls, "updateCard"), []);
});

test("preset list is open to a worker thread", async () => {
  const { invoke } = cliHarness({
    presetHandlers: {
      listPresets: async () => ({
        presets: [
          {
            id: "preset_1",
            name: "Builder",
            isDefault: true,
            builtIn: false,
            providerId: "pi",
            modelId: "m",
            reasoningLevel: "medium",
            permissionMode: "full",
          },
        ],
      }),
    },
  });
  const result = await invoke(["preset", "list"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /preset_1\t\*\s+Builder\tpi\/m/);
});

test("seed from inside a card thread refuses with the card's own state dir", async () => {
  const { invoke, calls } = cliHarness();
  const result = await invoke(["seed", "--name", "n", "--intent", "feature"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /never run `bb stelow seed`/);
  assert.match(result.stderr, /\/w\/\.stelow\/state/);
  assert.deepEqual(
    callsNamed(calls, "seed"),
    [],
    "a card-worker seed never mints a project-root workflow",
  );
});

test("storage reports unattributed worktrees instead of hiding them", async () => {
  const { invoke } = cliHarness({
    environments: [
      { id: "env_1", path: "/elsewhere", isWorktree: true, status: "ready" },
    ],
  });
  const result = await invoke(["storage"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /unattributed/);
  assert.match(result.stdout, /no path|elsewhere/);
});

test("lock refuses an unknown operation with the usage line", async () => {
  const { invoke, calls } = cliHarness();
  const result = await invoke(["lock", "steal"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /acquire\|release\|check/);
  assert.deepEqual(callsNamed(calls, "helper"), []);
});

test("sync-scopes runs the helper and refreshes the card it wrote to", async () => {
  const { invoke, calls } = cliHarness({ helper: { code: 0, stdout: "synced", stderr: "" } });
  const result = await invoke(["sync-scopes"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "synced");
  assert.deepEqual(
    callsNamed(calls, "helper").map(([, args]) => args[0]),
    ["sync-scopes"],
  );
  assert.deepEqual(
    callsNamed(calls, "publish").map(([, event]) => event),
    ["card-state", "board-changed"],
  );
});

test("preview without a card says so instead of guessing the thread", async () => {
  const { invoke, calls } = cliHarness();
  const result = await invoke(["preview", "status"], { threadId: null });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /No card found/);
  assert.deepEqual(callsNamed(calls, "updateCard"), []);
});

test("fan-out needs opportunity ids, never prose", async () => {
  const { invoke, calls } = cliHarness();
  const none = await invoke(["fan-out"]);
  assert.equal(none.exitCode, 2);
  assert.match(none.stderr, /at least one --opportunity/);
  assert.deepEqual(callsNamed(calls, "callRpc"), []);

  const ok = cliHarness({
    card: buildCard({ kind: "research" }),
    rpcResult: {
      ok: true,
      created: [{ cardId: "card_new", title: "Retry checkout" }],
      error: null,
    },
  });
  const result = await ok.invoke([
    "fan-out",
    "--opportunity",
    "opp-1",
    "--opportunity",
    "opp-2",
  ]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Fanned out 1: Retry checkout \(card_new\)/);
  const rpc = firstCall(ok.calls, "callRpc");
  assert.equal(rpc[1].method, "fanOutResearch");
  assert.deepEqual(rpc[1].input, {
    cardId: "card_1",
    opportunityIds: ["opp-1", "opp-2"],
  });
});
