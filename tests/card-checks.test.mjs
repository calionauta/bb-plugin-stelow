import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { groupCardChecks, groupState, isExecutionUntracked } from "../lib/card-checks.mjs";

const scopes = [
  { id: "s1", name: "Checkout", status: "done", tasks: [{ name: "t1", status: "done" }] },
  { id: "s2", name: "Apple Pay", status: "in-progress", tasks: [{ name: "t2", status: "in-progress" }, { name: "t3", status: "pending" }] },
];
const questions = [{ title: "Ship it?", question: "Ship it?" }];
const gaps = {
  matched: true,
  items: [
    { description: "Missing test", resolution: "escalate", scopeStatus: null },
    { description: "Stale docs", resolution: "documented", scopeStatus: null },
  ],
  fixed: 2,
  documented: 1,
  total: 4,
};
// The header and the rollup must account for the same gaps, so the counters
// describe MORE than the items carry: fixed+documented is 3, the list has 2.

// Groups read by type with done/pending counts, from the same sources the
// heroes read — scopes, tasks, questions, gaps, review. Nothing invented.
const groups = groupCardChecks({ questions, scopes, gaps, review: { pending: false, done: false } });
assert.deepEqual(groups.map((group) => group.id), ["scopes", "tasks", "questions", "gaps"], "types group in stable order");
const byId = new Map(groups.map((group) => [group.id, group]));
assert.deepEqual(byId.get("scopes"), { id: "scopes", label: "Scopes", open: ["Apple Pay"], doneCount: 1, total: 2 }, "scopes split open from done");
assert.deepEqual(byId.get("tasks"), { id: "tasks", label: "Tasks", open: ["t2", "t3"], doneCount: 1, total: 3 }, "tasks split across scopes");
assert.deepEqual(byId.get("questions"), { id: "questions", label: "Questions", open: ["Ship it?"], doneCount: 0, total: 1 }, "questions list titles");
assert.deepEqual(byId.get("gaps"), { id: "gaps", label: "Gaps", open: ["Missing test"], doneCount: 3, total: 4 }, "gaps count fixed+documented as done");

// A documented finding is closed by its disposition, and an escalation closes
// when its rework scope finishes — neither is work the reader is waiting on.
const settledGaps = {
  matched: true,
  items: [
    { description: "Missing test", resolution: "escalate", scopeStatus: "planned" },
    { description: "Landed already", resolution: "escalate", scopeStatus: "done" },
    { description: "Stale docs", resolution: "documented", scopeStatus: null },
    { description: "Typo", resolution: "fixed", scopeStatus: null },
  ],
  fixed: 1,
  documented: 1,
  escalated: 2,
  total: 4,
};
const settled = new Map(groupCardChecks({ questions: [], scopes: [], gaps: settledGaps, review: null }).map((group) => [group.id, group]));
assert.deepEqual(settled.get("gaps").open, ["Missing test"], "only an escalation without a finished rework scope is open work");
assert.equal(settled.get("gaps").total, 4, "the total still counts every finding the registry named");
// done + open must equal total. This is the assertion that was missing: the
// rollup counted only fixed+documented as done, so a settled escalation sat in
// the total and in neither list, and the row read "1/4 open" against 1 name.
assert.equal(
  settled.get("gaps").doneCount + settled.get("gaps").open.length,
  settled.get("gaps").total,
  "every gap is either open or done — the rollup and the header account for the same findings",
);
assert.equal(settled.get("gaps").doneCount, 3, "fixed + documented + the escalation whose rework scope finished");

// Groups with no applicable items resolve absent, never empty: review on
// a card going nowhere is noise, and unmatched gaps stay invisible.
assert.deepEqual(groupCardChecks({ questions: [], scopes: [], gaps: null, review: null }), [], "nothing applicable resolves to no groups");
assert.deepEqual(
  groupCardChecks({ questions: [], scopes: [], gaps: null, review: { pending: true, done: false } }).map((group) => group.id),
  ["review"],
  "review resolves alone when it is the only pending thing",
);
assert.deepEqual(
  groupCardChecks({ questions: [], scopes: [], gaps: { matched: false, items: [], fixed: 0, documented: 0, total: 0 }, review: null }),
  [],
  "unmatched gaps stay invisible",
);

// State is done only with items and none open; the filter reads it.
assert.equal(groupState({ open: [], doneCount: 2, total: 2 }), "done", "all closed reads done");
assert.equal(groupState({ open: ["x"], doneCount: 1, total: 2 }), "pending", "any open reads pending");
assert.equal(groupState(null), "empty", "junk reads empty");
assert.equal(groupState({}), "empty", "shapeless reads empty");

// The extracted detail section and the progress rollup are driven, not read:
// one render of the extracted section exercises the wrapper's own props AND
// every rollup rule below, while the host answers `gapSummary` through a stub
// so the request COUNT is observable rather than grepped. A text pin could not
// tell a live call from a comment about one, and could not see a dead branch at
// all.
const rpcCalls = [];
globalThis.__bbPluginRuntime = {
  pluginSdkApp: {
    useRpc: () => ({
      call: async (name, payload) => {
        rpcCalls.push([name, payload]);
        // The header and the rollup must account for the same gaps: one
        // escalation with no rework scope reads open, one documented finding
        // reads closed, and the total is both of them.
        return name === "gapSummary"
          ? {
              matched: true,
              items: [{ description: "Missing test", resolution: "escalate", scopeStatus: null }],
              fixed: 0,
              documented: 1,
              total: 2,
            }
          : {};
      },
    }),
  },
};
register(pathToFileURL(new URL("./register-tsx.mjs", import.meta.url).pathname), import.meta.url);
await import("./dom-setup.mjs");
const { createElement: h } = await import("react");
const { render, screen, cleanup, waitFor } = await import("@testing-library/react");
const { BuildProgressSection } = await import("../components/detail/build-detail-progress.tsx");

const buildCard = (overrides = {}) => ({
  id: "card_1",
  status: "in-progress",
  activity: "running",
  stage: "execution",
  workspaceKind: "project",
  hasPendingReview: false,
  displayName: "Checkout",
  ...overrides,
});
const buildDetail = (overrides = {}) => ({
  scopes: [{ id: "s1", name: "Checkout", status: "in-progress", tasks: [{ id: "t1", name: "task one", status: "pending" }] }],
  pendingQuestions: [{ id: "q1", title: "Ship it?" }],
  expiredQuestions: [{ id: "q2", title: "Old ask?" }],
  mentionedFiles: [],
  fileOccupancy: null,
  scopeXray: null,
  scopeDraft: null,
  scopeSync: null,
  fileEnvironmentId: null,
  artifacts: [],
  card: { leadMs: null, cycleMs: null, scopeSummary: { scopesDone: 0, scopesTotal: 1, tasksDone: 0, tasksTotal: 1 } },
  ...overrides,
});

async function renderProgress(card = buildCard(), detail = buildDetail()) {
  rpcCalls.length = 0;
  const view = { card, detail, showArtifacts: () => {}, setViewerFile: () => {} };
  const tree = render(h(BuildProgressSection, { view }));
  await waitFor(() => assert.ok(rpcCalls.length > 0, "the rollup asks the host for the gap summary"));
  return tree;
}

const section = await renderProgress();
assert.match(
  section.container.textContent ?? "",
  /Workflow progress/,
  "the extracted detail section renders the progress rollup with the card and detail it was handed",
);
assert.equal(
  rpcCalls.filter(([name]) => name === "gapSummary").length,
  1,
  "checks and gaps share one gapSummary request",
);
assert.ok(screen.getByText(/Ship it\? · Old ask\?/), "questions cover live and expired asks");
assert.equal(screen.getByRole("checkbox").checked, true, "the pending filter defaults on");
cleanup();

// Review is a fact about the card, never inferred: a completed card with a
// pending review shows the group, a live one does not.
await renderProgress(buildCard({ status: "completed", hasPendingReview: true }));
assert.ok(screen.getByText("Review"), "a completed card with a pending review shows the Review group");
cleanup();
await renderProgress();
assert.equal(screen.queryByText("Review"), null, "a card that is going nowhere shows no review group");
cleanup();

// Untracked execution is read from live card state (activity + the scopes it
// was handed), so a running card whose scopes were never marked warns.
await renderProgress(
  buildCard(),
  buildDetail({ scopes: [{ id: "s1", name: "Checkout", status: "pending", tasks: [] }] }),
);
assert.ok(
  screen.getByText(/no scope marked started/),
  "the rollup names untracked execution from live card state",
);
cleanup();

// The removed signal stays removed: a late-stage card with no tracker no
// longer prints the copy that named a spec it never had.
const lateStage = await renderProgress(
  buildCard({ stage: "execution" }),
  buildDetail({ scopes: [], pendingQuestions: [], expiredQuestions: [] }),
);
assert.doesNotMatch(
  lateStage.container.textContent ?? "",
  /No synced scopes on this card/,
  "the copy that named a nonexistent spec is gone",
);
cleanup();

// Untracked execution: running with synced scopes but nothing ever marked
// (neither in-progress nor done) names the silence bands — the exact shape
// of a done-with-pending-scopes surprise, caught while there is still time.
assert.equal(isExecutionUntracked({ activity: "running", scopes: [{ status: "pending" }, { status: "pending" }] }), true, "running with all scopes pending warns");
assert.equal(isExecutionUntracked({ activity: "running", scopes: [{ status: "done" }] }), false, "a finished scope is marking enough");
assert.equal(isExecutionUntracked({ activity: "running", scopes: [{ status: "in-progress" }] }), false, "an in-progress scope is marking");
assert.equal(isExecutionUntracked({ activity: "running", scopes: [{ status: "skipped" }] }), true, "all-skipped while running still warns — skipping everything is the same silence");
assert.equal(isExecutionUntracked({ activity: "idle", scopes }), false, "idle workers are paused, not untracked");
assert.equal(isExecutionUntracked({ activity: "running", scopes: [] }), false, "no scopes means nothing to track");
assert.equal(isExecutionUntracked({ activity: "running", scopes: null }), false, "junk never warns");

console.log("card checks test ok: grouped types, done/pending states, absent empties");
