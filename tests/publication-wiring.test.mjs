import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");
const app = readFileSync(join(root, "app.tsx"), "utf8");

for (const method of ["publicationStatus", "publicationCommitDiff", "publicationCommit", "publicationSquashMerge", "publicationPullRequestAction"]) {
  assert.match(server, new RegExp(`async ${method}\\(`), `${method} RPC exists`);
}
assert.match(server, /bb\.sdk\.environments\.status/, "publication status is owned by BB");
assert.match(server, /bb\.sdk\.environments\.commit/, "commit is routed to BB's environment host");
assert.match(server, /bb\.sdk\.environments\.squashMerge/, "local squash merge is routed to BB");
assert.match(server, /bb\.sdk\.environments\.markPullRequestReady/, "PR ready transition is routed to BB");
assert.match(server, /bb\.sdk\.environments\.markPullRequestDraft/, "PR draft transition is routed to BB");
assert.match(server, /bb\.sdk\.environments\.mergePullRequest/, "PR merge is routed to BB");
assert.match(server, /publicationSnapshot\(card\)/, "each mutating action runs a fresh preflight");
assert.match(server, /canMarkPullRequestReady\(status, pullRequest\)/, "ready transition shares the workspace safety policy");
assert.match(server, /canMarkPullRequestDraft\(status, pullRequest\)/, "draft transition shares the workspace safety policy");
assert.match(server, /publication_events/, "publication writes are separately auditable");
assert.match(server, /commit_sha = \?/, "commit review is limited to card-recorded publication history");
assert.match(server, /bb\.sdk\.environments\.diffFiles/, "commit review uses BB's native environment diff API");
assert.match(server, /bb\.sdk\.environments\.diffPatch/, "missing file patches are fetched from BB instead of given up on");
assert.match(server, /stelow commit diff: diffPatch (unavailable|failed)/, "patch fetch failures are logged for diagnosis instead of swallowed");
assert.match(server, /initialPatches is empty even/, "commit targets fetch every missing patch, not just on-demand ones");
assert.match(app, /file\.loadMode === "too_large"/, "the commit viewer distinguishes too-large files from missing patches");
assert.match(server, /if \(result\.merged\) recordPublication/, "only completed local merges enter publication history");
assert.match(server, /cardCheckout\(card\)/, "diff/preview/publication share the worker-first checkout resolver");
assert.doesNotMatch(server, /execFile\("git", \["commit"/, "publication never shells out to a local Git commit");
assert.match(server, /selectedCardEnvironment\(environment, workerEnvironment/, "a card forwards the BB composer environment instead of replacing it with a preset");
assert.match(server, /continuingWorkerEnvironment\(row/, "later workers reuse the card's selected BB environment");
assert.match(server, /text: AUDIT_DONE_NUDGE, mentions: \[\], visibility: "agent-only"/, "automatic audit recovery stays out of the user conversation");
assert.match(server, /text: buildContinueNudge\(\), mentions: \[\], visibility: "agent-only"/, "automatic continuations stay out of the user conversation");

assert.match(app, /title="Git changes"/, "Done cards have a dedicated Git changes panel");
assert.match(app, /Commit workspace…/, "commit requires an explicit user action");
assert.match(app, /Save local commit to/, "a BB-selected default checkout is described as a local commit");
assert.match(app, /default checkout selected in BB/, "the publication panel explains that BB's checkout choice is respected");
assert.match(app, /cannot fetch remote updates, merge incoming changes, push, or create a pull request/, "the publication panel does not promise remote synchronization the BB API does not expose");
assert.match(app, /Advanced Git operations/, "local squash integration is progressively disclosed");
assert.match(app, /Squash branch locally/, "local squash integration uses plain-language copy");
assert.match(app, /Merge PR…/, "PR merge remains an explicit user action");
assert.match(app, /publicationSubmitting/, "publication confirmations prevent duplicate write requests");
assert.match(app, /Repository rules, approvals, checks, and merge queues remain authoritative/, "merge confirmation does not bypass repository policy");
assert.match(app, /Publication history/, "the user can audit prior publication actions");
assert.match(app, /Saved locally on/, "a successful local save has an explicit outcome state");
assert.match(app, /View commit/, "recorded local commits can be inspected from Done");
assert.match(app, /This commit has not been pushed or merged remotely/, "local save does not imply remote publication");

console.log("publication wiring test ok: BB owns writes, Done stays separate, actions are explicit and auditable");
