import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { buildCreateIssueArgs, buildDoneCommentBrief, CREATE_OUTCOME_UNCERTAIN_MARKER, issueBodyForCard, issueKey, issueMarker, parseCreateIssueResponse, resolveGhPath, resolveTargetRepo, validatePostBody } from "../lib/github-issue-create.mjs";
import { githubRpcContract } from "../server/github-rpc-contract.ts";
import { cardRpcContract } from "../server/card-rpc-contract.ts";
import { githubIssueFlowHandlers } from "../server/github-issue-flow.ts";
import { findElementByType, loadComponent } from "./helpers/render-component.mjs";

// Card-birth issue creation: the card always exists first, so every failure
// below must leave a retryable state, never a silent half-link. The uncertain
// outcome (write may have committed, response lost) is the case that would
// double-create on retry — it names itself instead of failing quietly.

// Provenance marker travels in the issue body: a future importer can tell a
// Stelow-born issue from a human one without a second lookup.
assert.equal(issueMarker("card_1"), "<!-- stelow-card:card_1 -->", "marker carries the card id");
assert.notEqual(issueMarker("card_1"), issueMarker("card_2"), "markers differ per card");
assert.equal(issueKey("octo/repo", 12), "octo/repo#12", "link key matches the importer convention");

// Args mirror taskboard's gh call shape: POST to the repo endpoint with raw
// title and body fields. A mistyped repo must fail here, not in a shell.
assert.deepEqual(
  buildCreateIssueArgs({ repo: "octo/repo", title: " Fix it ", body: "Work.\n\n<!-- stelow-card:card_1 -->" }),
  ["api", "--method", "POST", "repos/octo/repo/issues", "--raw-field", "title=Fix it", "--raw-field", "body=Work.\n\n<!-- stelow-card:card_1 -->"],
  "gh args post title and body to the repo endpoint",
);
assert.throws(() => buildCreateIssueArgs({ repo: "octo/repo", title: "   ", body: "" }), /must not be empty/, "blank titles refuse before spawning");
assert.throws(() => buildCreateIssueArgs({ repo: "not-a-repo", title: "T", body: "" }), /owner\/name/, "malformed repos refuse before spawning");
assert.equal(issueBodyForCard({ prompt: "Build the thing.", cardId: "card_9" }), "Build the thing.\n\n<!-- stelow-card:card_9 -->", "body joins prompt and marker");

// Response parsing is strict: only a positive integer number plus a URL
// counts as created. Anything else is the uncertain outcome.
assert.deepEqual(
  parseCreateIssueResponse(JSON.stringify({ number: 7, html_url: "https://github.com/octo/repo/issues/7" })),
  { number: 7, url: "https://github.com/octo/repo/issues/7" },
  "a well-formed response resolves the link",
);
for (const raw of ["not json at all", JSON.stringify({ number: "7", html_url: "https://x" }), JSON.stringify({ number: 7 }), JSON.stringify({ number: -2, html_url: "https://x" }), ""]) {
  assert.throws(() => parseCreateIssueResponse(raw), /may have created/, "an unconfirmed write reports uncertain, never ok");
}
try {
  parseCreateIssueResponse("garbage");
  assert.fail("unreadable responses must throw");
} catch (error) {
  assert.ok(error instanceof Error && error.message.includes(CREATE_OUTCOME_UNCERTAIN_MARKER), "the uncertain outcome carries a machine-detectable marker");
}

// Repo selection is one rule everywhere: explicit picks must be mapped,
// silence needs exactly one mapped repo, anything else refuses loudly.
assert.deepEqual(resolveTargetRepo({ mapped: ["octo/a"], requested: null }), { ok: true, repo: "octo/a", error: null }, "a lone mapped repo resolves silently");
assert.deepEqual(resolveTargetRepo({ mapped: ["octo/a", "octo/b"], requested: "octo/b" }), { ok: true, repo: "octo/b", error: null }, "an explicit mapped pick wins");
assert.deepEqual(resolveTargetRepo({ mapped: ["octo/a"], requested: "octo/zzz" }).ok, false, "an unmapped pick refuses");
assert.deepEqual(resolveTargetRepo({ mapped: [], requested: null }).ok, false, "no mapped repo refuses with the redirect");
assert.deepEqual(resolveTargetRepo({ mapped: ["octo/a", "octo/b"], requested: null }).ok, false, "ambiguity refuses instead of guessing");

// Human post validation: empty and oversized bodies refuse; the server
// enforces this even though only the UI calls it today.
assert.deepEqual(validatePostBody("  hello  "), { ok: true, text: "hello", error: null }, "posts trim");
assert.deepEqual(validatePostBody("   ").ok, false, "blank posts refuse");
assert.deepEqual(validatePostBody("x".repeat(60001)).ok, false, "oversized posts refuse");

// Done-note brief: facts in, honesty rules attached, artifacts deliberately
// absent (they ride as a detachable checklist, never as model claims).
const brief = buildDoneCommentBrief({ title: "Ship it", intent: "feature", stage: "done", scopesDone: 2, scopesTotal: 2, scopeLines: ["- API (done)", "- Docs (done)"], promptExcerpt: "Build the thing." });
assert.match(brief, /Scopes: 2\/2 done\./, "brief carries the scope count");
assert.match(brief, /never invent results/, "brief binds the model to the context");

// gh resolution walks taskboard's candidate order with an injected probe,
// so the fallback chain is testable without a shell.
assert.equal(await resolveGhPath(async (cmd) => cmd === "/opt/homebrew/bin/gh"), "/opt/homebrew/bin/gh", "first working candidate wins");
assert.equal(await resolveGhPath(async () => true), "gh", "PATH gh wins when present");
await assert.rejects(resolveGhPath(async () => { throw new Error("nope"); }), /not available/, "a throwing probe counts as a miss");
await assert.rejects(resolveGhPath(async () => false), /not available/, "no working gh refuses with the redirect");

// Contract presence is asked of the imported contracts, and the opt-in row is
// rendered — both prove the wiring by what it exposes, not by what the file says.
assert.ok(githubRpcContract.createLinkedGithubIssue, "the RPC is contracted");
assert.equal(typeof githubRpcContract.createLinkedGithubIssue.experimental_description, "string", "and discoverable");
assert.ok(cardRpcContract.draftDoneComment, "the draft RPC is contracted");

function allText(node) {
  const parts = [];
  const visit = (current) => {
    if (typeof current === "string") { parts.push(current); return; }
    if (!current || typeof current !== "object") return;
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return parts.join(" ");
}

{
  const Row = loadComponent("components/github/github-create-row.tsx", "GithubCreateRow", {});
  const props = { checked: false, onCheckedChange: () => {}, repo: null, onRepoChange: () => {} };
  const single = Row({ ...props, repos: ["octo/a"] });
  assert.match(allText(single), /Also create issue\s+in octo\/a/, "the opt-in checkbox names the destination");

  const several = Row({ ...props, repos: ["octo/a", "octo/b"] });
  assert.ok(findElementByType(several, "select"), "several mapped repos force an explicit picker");
  assert.match(allText(several), /Pick a repository/, "with a placeholder, never a silent default");
  assert.equal(Row({ ...props, repos: [] }), null, "no mapped repo renders no control at all");
}

// The RPC is wired to the flow slice, driven: a card that already carries a
// link returns that link instead of creating a second issue, so a handler
// declared and forgotten behind the contract fails here rather than passing.
const linkedCard = { id: "card-1", display_name: "Fix login", name: "Fix login", prompt: "It 500s on submit.", project_id: "project-1", status: "active" };
const linkDb = {
  prepare(sql) {
    return { get: () => sql.includes("FROM cards") ? linkedCard : { repo: "octo/a", number: 7 } };
  },
};
const flowHandlers = githubIssueFlowHandlers(
  { db: linkDb, bb: { realtime: { publish() {} } }, cards: { cardStatusOf: () => "active" } },
  {},
);
assert.deepEqual(
  await flowHandlers.createLinkedGithubIssue({ cardId: "card-1" }),
  { ok: true, url: "https://github.com/octo/a/issues/7", number: 7, error: null },
  "the wired flow slice answers with the card's existing link",
);

// The two dialogs are React hook components: the busy guard lives inside the
// submit closure and the draft RPC inside an effect, so neither exists without
// a runtime to mount. They are mounted and driven — the click is the assertion,
// and a guard that never ran fails here instead of matching its own source.
const dialogCalls = [];
const dialogRpc = {
  call: async (method, payload) => {
    dialogCalls.push({ method, payload });
    if (method === "createCard") return { cardId: "card-1", threadId: "thread-1" };
    if (method === "createLinkedGithubIssue") return { ok: true, url: "https://github.com/octo/a/issues/7", number: 7 };
    if (method === "draftDoneComment") return { ok: true, draft: "Drafted completion note." };
    return { ok: true };
  },
};
function TestComposer({ onSubmit }) {
  return h("button", { type: "button", onClick: () => void onSubmit({
    projectId: "project-1",
    input: [{ type: "text", text: "Build the thing." }],
    environment: null,
    providerId: "provider-a",
    model: "model-a",
    reasoningLevel: "high",
    permissionMode: "full",
  }) }, "Start build");
}
globalThis.__bbPluginRuntime = {
  pluginSdkApp: {
    useRpc: () => dialogRpc,
    useBbNavigate: () => ({ openThreadPanel: () => {} }),
    experimental_NewThreadComposer: TestComposer,
  },
};
register(pathToFileURL(new URL("./register-tsx.mjs", import.meta.url).pathname), import.meta.url);
await import("./dom-setup.mjs");
const { createElement: h } = await import("react");
const { render, screen, fireEvent, act, cleanup } = await import("@testing-library/react");
const { CreateBuildDialog } = await import("../components/creation/create-build-dialog.tsx");
const { GithubDoneDraftDialog } = await import("../components/github/github-done-draft-dialog.tsx");

function buildDialogProps() {
  return {
    open: true,
    onOpenChange: () => {},
    activeProjectId: "project-1",
    validProjectIds: ["project-1"],
    analysisPreset: null,
    prefs: { quality: "production", supervisor: "high", explorationCount: "3", redFirst: "strict" },
    reviewGates: [],
    githubRepos: ["octo/a"],
    onPrefsChange: () => {},
    onReviewGatesChange: () => {},
    bucketGallery: { openBucketGallery: () => {}, bucketGallery: null },
    onOpenPresets: () => {},
  };
}

render(h(CreateBuildDialog, buildDialogProps()));
const optIn = screen.getByRole("checkbox", { name: /Also create issue/ });
assert.equal(optIn.checked, false, "creation stays off by default");
const submit = screen.getByRole("button", { name: "Start build" });
await act(async () => {
  fireEvent.click(submit);
  fireEvent.click(submit);
});
assert.deepEqual(
  dialogCalls.map((call) => call.method),
  ["createCard"],
  "a double click creates one card, not two — the flag is set before the write",
);

dialogCalls.length = 0;
fireEvent.click(optIn);
assert.equal(optIn.checked, true, "the opt-in is what turns issue creation on");
await act(async () => { fireEvent.click(submit); });
assert.deepEqual(
  dialogCalls,
  [
    { method: "createCard", payload: dialogCalls[0].payload },
    { method: "createLinkedGithubIssue", payload: { cardId: "card-1", repo: null } },
  ],
  "the dialog asks for the issue only after the card exists, and the cleared flag lets a second submit through",
);
cleanup();

render(h(GithubDoneDraftDialog, { open: true, onOpenChange: () => {}, cardId: "card-1", artifacts: [], issueRef: { repo: "octo/a", number: 7 } }));
await act(async () => {});
assert.deepEqual(dialogCalls.slice(-1), [{ method: "draftDoneComment", payload: { cardId: "card-1" } }], "the Done dialog drafts through the RPC");
assert.ok(screen.getByText("Draft GitHub comment?"), "the dialog names the action");
cleanup();

console.log("github issue create test ok: marker, args, strict parse, gh resolution, wired flow slice, and both dialogs mounted");
