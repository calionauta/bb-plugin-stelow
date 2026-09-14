import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");
const app = readFileSync(join(root, "app.tsx"), "utf8");

for (const method of ["publicationStatus", "publicationCommit", "publicationSquashMerge", "publicationPullRequestAction"]) {
  assert.match(server, new RegExp(`async ${method}\\(`), `${method} RPC exists`);
}
assert.match(server, /bb\.sdk\.environments\.status/, "publication status is owned by BB");
assert.match(server, /bb\.sdk\.environments\.commit/, "commit is routed to BB's environment host");
assert.match(server, /bb\.sdk\.environments\.squashMerge/, "local squash merge is routed to BB");
assert.match(server, /bb\.sdk\.environments\.markPullRequestReady/, "PR ready transition is routed to BB");
assert.match(server, /bb\.sdk\.environments\.markPullRequestDraft/, "PR draft transition is routed to BB");
assert.match(server, /bb\.sdk\.environments\.mergePullRequest/, "PR merge is routed to BB");
assert.match(server, /publicationSnapshot\(card\)/, "each mutating action runs a fresh preflight");
assert.match(server, /publication_events/, "publication writes are separately auditable");
assert.match(server, /cardCheckout\(card\)/, "diff/preview/publication share the worker-first checkout resolver");
assert.doesNotMatch(server, /execFile\("git", \["commit"/, "publication never shells out to a local Git commit");

assert.match(app, /title="Publish changes"/, "Done cards have a dedicated publication panel");
assert.match(app, /Commit workspace…/, "commit requires an explicit user action");
assert.match(app, /Merge PR…/, "PR merge remains an explicit user action");
assert.match(app, /Repository rules, approvals, checks, and merge queues remain authoritative/, "merge confirmation does not bypass repository policy");
assert.match(app, /Publication history/, "the user can audit prior publication actions");

console.log("publication wiring test ok: BB owns writes, Done stays separate, actions are explicit and auditable");
