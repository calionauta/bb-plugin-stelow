import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCreateIssueArgs, buildDoneCommentBrief, CREATE_OUTCOME_UNCERTAIN_MARKER, issueBodyForCard, issueKey, issueMarker, parseCreateIssueResponse, resolveGhPath, resolveTargetRepo, validatePostBody } from "../lib/github-issue-create.mjs";

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

// Submit guard: the modular Build start sets a busy ref before createCard and
// clears it on every terminal path, so a double-click cannot create two cards
// (and two issues). Order is the contract — a guard after the call guards
// nothing.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contract = readFileSync(join(root, "server/github-issues.ts"), "utf8");
const createDialog = readFileSync(join(root, "components/creation/create-build-dialog.tsx"), "utf8");
const doneDraft = readFileSync(join(root, "components/github/github-done-draft-dialog.tsx"), "utf8");
const buildStart = createDialog.slice(createDialog.indexOf("async function start(request: NewThreadRequest)"), createDialog.indexOf("function resetOnOpen()"));
assert.ok(buildStart.indexOf("if (!submission.trim() || submitBusyRef.current) return;") < buildStart.indexOf('rpc.call("createCard"'), "the busy guard precedes the card write");
assert.ok(buildStart.indexOf("submitBusyRef.current = false") > buildStart.indexOf('rpc.call("createCard"'), "the flag clears after the write paths");
assert.match(contract, /createLinkedGithubIssue: \{/, "the RPC is contracted");
assert.match(contract, /async createLinkedGithubIssue\(\{ cardId/, "the RPC is implemented");
assert.match(createDialog, /rpc\.call\("createLinkedGithubIssue"/, "the creation dialog calls it after the card exists");
assert.match(readFileSync(join(root, "components/github/github-create-row.tsx"), "utf8"), /Also create issue\{/, "the opt-in checkbox names the destination");
assert.match(readFileSync(join(root, "components/github/github-create-row.tsx"), "utf8"), /Pick a repository/, "several mapped repos force an explicit pick, never a silent default");
assert.match(createDialog, /const \[createGithubIssue, setCreateGithubIssue\] = useState\(false\)/, "creation stays off by default");
assert.match(readFileSync(join(root, "server.ts"), "utf8"), /draftDoneComment: \{/, "the draft RPC is contracted");
assert.match(doneDraft, /rpc\.call\("draftDoneComment"/, "the Done dialog drafts through the RPC");
assert.match(doneDraft, /Draft GitHub comment\?/, "the dialog names the action");

console.log("github issue create test ok: marker, args, strict parse, gh resolution, wiring");
