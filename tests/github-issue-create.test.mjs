import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCreateIssueArgs, issueBodyForCard, issueKey, issueMarker, parseCreateIssueResponse, resolveGhPath } from "../lib/github-issue-create.mjs";

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

// gh resolution walks taskboard's candidate order with an injected probe,
// so the fallback chain is testable without a shell.
assert.equal(await resolveGhPath(async (cmd) => cmd === "/opt/homebrew/bin/gh"), "/opt/homebrew/bin/gh", "first working candidate wins");
assert.equal(await resolveGhPath(async () => true), "gh", "PATH gh wins when present");
await assert.rejects(resolveGhPath(async () => { throw new Error("nope"); }), /not available/, "a throwing probe counts as a miss");
await assert.rejects(resolveGhPath(async () => false), /not available/, "no working gh refuses with the redirect");

// Wiring: the RPC exists in contract and handlers, the Build dialog offers
// the opt-in checkbox, and creation stays off by default (external side
// effects never happen without a gesture).
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contract = readFileSync(join(root, "server/github-issues.ts"), "utf8");
assert.match(contract, /createLinkedGithubIssue: \{/, "the RPC is contracted");
assert.match(contract, /async createLinkedGithubIssue\(\{ cardId/, "the RPC is implemented");
const app = readFileSync(join(root, "app.tsx"), "utf8");
assert.match(app, /rpc\.call\("createLinkedGithubIssue"/, "the creation dialog calls it after the card exists");
assert.match(app, /Also create issue\{/, "the opt-in checkbox names the destination");
assert.match(app, /Pick a repository/, "several mapped repos force an explicit pick, never a silent default");
assert.match(app, /const \[createGithubIssue, setCreateGithubIssue\] = useState\(false\)/, "creation stays off by default");

console.log("github issue create test ok: marker, args, strict parse, gh resolution, wiring");
