import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = readFileSync(join(root, "server.ts"), "utf8");
const publicationContract = readFileSync(
  join(root, "server/artifacts-publication.ts"),
  "utf8",
);
const publicationOperations = readFileSync(
  join(root, "server/artifacts-publication-operations.ts"),
  "utf8",
);
const server = [
  serverRoot,
  readFileSync(join(root, "server", "plugin-runtime.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/build-thread-sync.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/thread-send.ts"), "utf8"),
  readFileSync(join(root, "server/workers.ts"), "utf8"),
  publicationContract,
  readFileSync(join(root, "server/artifacts-publication-commits.ts"), "utf8"),
  readFileSync(join(root, "server/artifacts-publication-status.ts"), "utf8"),
  publicationOperations,
  readFileSync(join(root, "server/artifacts-publication-terminals.ts"), "utf8"),
  readFileSync(join(root, "server/cards-create.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/cli/cli-done-build.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/cli/cli-verify.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/cli/cli-review.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/wiring/host-surfaces.ts"), "utf8"),
].join("\n");
const publication = readFileSync(join(root, "components/detail/build-publication.tsx"), "utf8");
const actions = readFileSync(join(root, "components/detail/build-publication-actions.tsx"), "utf8");
const diff = readFileSync(join(root, "components/detail/build-diff.tsx"), "utf8");
const commitDiff = readFileSync(join(root, "components/detail/build-commit-diff.tsx"), "utf8");
const reviewTools = readFileSync(join(root, "components/detail/build-detail-review-tools.tsx"), "utf8");
const executeActionStart = actions.indexOf("async function executeAction(");
const actionTitleStart = actions.indexOf("function actionTitle(", executeActionStart);
assert.ok(executeActionStart >= 0 && actionTitleStart > executeActionStart, "publication action dispatcher is testable");
const executeAction = actions.slice(executeActionStart, actionTitleStart);

for (const method of ["publicationStatus", "publicationCommitDiff", "publicationCommit", "publicationSquashMerge", "publicationPushTerminal", "publicationPushTerminals", "publicationPullPush", "publicationPullRequestAction"]) {
  assert.match(publicationContract, new RegExp(`${method}:`), `${method} contract is owned by the feature root`);
  assert.match(
    publicationOperations,
    new RegExp(`(?:async\\s+)?${method}\\s*[:(]`),
    `${method} handler is owned by operations`,
  );
  assert.doesNotMatch(
    serverRoot,
    new RegExp(`(?:async )?${method}\\s*[:(]`),
    `${method} has no publication clone in server.ts`,
  );
}
assert.match(server, /bb\.sdk\.environments\.status/, "publication status is owned by BB");
assert.match(server, /bb\.sdk\.environments\.commit/, "commit is routed to BB's environment host");
assert.match(server, /buildSquashScript\(\{ base, branch/, "local squash merge runs git merge --squash in the card's own shell (BB exposes no local squash action)");
assert.match(server, /parseSquashOutput\(tail\)/, "the squash verdict is parsed from terminal output, never assumed");
assert.match(server, /verdict\.finished/, "the squash shell is only closed after the branch restore runs");
assert.match(server, /bb\.sdk\.environments\.markPullRequestReady/, "PR ready transition is routed to BB");
assert.match(server, /bb\.sdk\.environments\.markPullRequestDraft/, "PR draft transition is routed to BB");
assert.match(server, /bb\.sdk\.environments\.mergePullRequest/, "PR merge is routed to BB");
assert.match(server, /publicationSnapshot\(deps, card\)/, "each mutating action runs a fresh preflight");
assert.match(server, /canMarkPullRequestReady\(status, pullRequest\)/, "ready transition shares the workspace safety policy");
assert.match(server, /canMarkPullRequestDraft\(status, pullRequest\)/, "draft transition shares the workspace safety policy");
assert.match(server, /publication_events/, "publication writes are separately auditable");
assert.match(server, /commit_sha = \?/, "commit review is limited to card-recorded publication history");
assert.match(server, /bb\.sdk\.environments\.diffFiles/, "commit review uses BB's native environment diff API");
assert.match(server, /bb\.sdk\.environments\.diffPatch/, "missing file patches are fetched from BB instead of given up on");
assert.match(server, /bb\.sdk\.terminals\.create/, "push opens a visible BB terminal instead of pushing silently");
assert.match(server, /start: \{ mode: "shell" \}/, "the push shell stays open for review instead of exiting like a one-shot command");
assert.match(server, /terminals\.input/, "git push is sent to the card's own shell, never run on an assumed host");
assert.match(server, /STELOW_PUSH_EXIT/, "the shell reports the push exit so the panel can name the outcome");
assert.match(server, /scope: \{ kind: "environment", environmentId/, "the push terminal runs in the card's own environment, never an assumed host");
assert.match(server, /push_terminal/, "terminal pushes enter publication history");
assert.match(server, /const action = sync \? "pull --rebase \+ push" : "git push"/, "sync runs enter history under the same auditable action");
assert.match(server, /publicationPullPush/, "rejected pushes have a one-click pull-rebase-plus-push remediation");
assert.match(server, /pull --rebase/, "the decided workflow is rebase (linear history, no merge commits for lay users)");
assert.match(server, /STELOW_SYNC_EXIT/, "the pull step reports its own exit separately from the push");
assert.match(server, /STELOW_SYNC_ABORTED/, "a conflicted pull aborts itself instead of stranding the checkout mid-rebase");
assert.match(server, /REBASE_HEAD/, "conflict detection reads rebase state, not output text");
assert.match(
  executeAction,
  /if \(action === "commit"\) \{[\s\S]*?rpc\.call\("publicationCommit", \{ cardId \}\)/,
  "commit actions use the BB commit RPC",
);
assert.match(
  executeAction,
  /else if \(action === "squash"\) \{[\s\S]*?rpc\.call\("publicationSquashMerge", \{ cardId \}\)/,
  "squash actions use the local squash RPC",
);
assert.match(
  executeAction,
  /action === "push"\s*\?\s*await context\.rpc\.call\("publicationPushTerminal", \{ cardId \}\)/,
  "push actions use the tracked push-terminal RPC",
);
assert.match(
  executeAction,
  /:\s*await context\.rpc\.call\("publicationPullPush", \{ cardId \}\)/,
  "sync actions use the pull-rebase-and-push RPC",
);
assert.match(
  executeAction,
  /rpc\.call\("publicationPullRequestAction", \{[\s\S]*?operation: action,[\s\S]*?action === "merge" \? \{ method: mergeMethod \}/,
  "pull-request actions forward the operation and selected merge method",
);
assert.match(actions, /Sync & push/, "a rejected push offers remediation where the failure is shown");
assert.match(publication, /Sync &amp; push again/, "failed shells carry their own retry that syncs first");
assert.match(publication, /STELOW_SYNC_ABORTED:1/, "an aborted sync names the manual exit instead of a dead end");
assert.doesNotMatch(publication, /pull first in BB’s sidebar terminal/, "push remediation never sends the user to hunt the sidebar");
assert.match(publication, /execCommand\("copy"\)/, "copy falls back to the legacy path when the Clipboard API is unavailable");
assert.match(publication, /select and copy by hand:/, "an uncopyable value still reaches the user inside the error");
assert.match(server, /could not be sent/, "a swallowed terminal-input failure never reports success with an empty shell");
assert.match(server, /publicationPushTerminals/, "push shells stay consultable after creation, never toast-only");
assert.match(server, /terminals\.list/, "consulting push shells lists the card environment's terminals");
assert.match(server, /terminals\.output/, "consulting push shells reads live terminal output");
assert.match(server, /outputTail/, "terminal output survives as a readable tail in the panel");
assert.match(server, /replace\(\/\[\^\\n\]\*\\r\(\?!\\n\)\/g, ""\)/, "progress spam collapses the way a real terminal renders it, keeping errors");
assert.match(publication, /Push shells/, "the panel tracks push shells with live output instead of sending the user to hunt the sidebar");
assert.match(publication, /Copy terminal ID/, "each push shell names its real BB terminal for sidebar lookup");
assert.match(publication, /Snapshot — refresh with Check result/, "the embedded output admits it is a snapshot, not an interactive terminal");
assert.match(publication, /○ Ended — output unavailable/, "an exited shell with no scrollback never reports Running");
assert.match(publication, /No push shell opened yet\./, "empty push state stays quiet when the action sits right above it");
assert.match(server, /already running in shell/, "a second push while one is in flight is refused instead of duplicating shells");
assert.match(server, /pushShellSessions/, "one push shell per card: predecessors are found before creating");
assert.match(server, /mode: "force"/, "retired finished/waiting shells are closed so runs never accumulate");
assert.match(publication, /Check result/, "push results are re-checkable after execution");
assert.match(publication, /Push now…/, "pushing is an explicit confirmed action that runs in the card's checkout");
assert.match(actions, /Push branch/, "the push confirmation names the action it takes");
assert.match(publication, /✓ Pushed/, "a finished push reads as pushed, not as raw terminal text");
assert.match(publication, /Waiting — git push typed but NOT sent/, "legacy typed-only shells name what is missing instead of looking executed");
assert.match(server, /stelow commit diff: diffPatch (unavailable|failed)/, "patch fetch failures are logged for diagnosis instead of swallowed");
assert.match(
  server,
  /filter\(\(file\) => \(\s*!file\.binary[\s\S]*?!patches\.has\(file\.path\)\s*\)\)/,
  "commit targets fetch every missing patch, not just on-demand ones",
);
assert.match(commitDiff, /commitFileState\(file\)/, "the commit viewer delegates tested file-state labels to presentation logic");
assert.match(server, /recordPublication\(deps, cardId, "squash_merge", message, verdict\.sha\)/, "only a verified squash SHA enters publication history");
assert.match(server, /deps\.cardCheckout\(card\)/, "diff/preview/publication share the worker-first checkout resolver");
assert.match(
  server,
  /checkout: \(card\) => seams\.cardCheckout\(card as WorkerCard\)/,
  "the host wiring injects the one worker-first checkout resolver",
);
assert.doesNotMatch(server, /execFile\("git", \["commit"/, "publication never shells out to a local Git commit");
assert.match(
  server,
  /selectCardEnvironment\(input\.environment, workerEnvironment/,
  "a card forwards the BB composer environment instead of replacing it with a preset",
);
assert.match(
  server,
  /(?:deps\.)?workers\.continuingEnvironment\(\s*card\s*,/,
  "later workers reuse the card's selected BB environment",
);
assert.match(server, /agentText\(deps\.auditDoneNudge\)/, "automatic audit recovery uses private agent text");
assert.match(
  server,
  /const input = buildContinueInput\([\s\S]*?buildContinueNudge\(deps\.interfacePick\)[\s\S]*?"private"/,
  "automatic continuations stay out of the user conversation",
);

assert.match(publication, /title="Git changes"/, "Done cards have a dedicated Git changes panel");
assert.match(publication, /Commit workspace…/, "commit requires an explicit user action");
assert.match(publication, /Save local commit to/, "a BB-selected default checkout is described as a local commit");
assert.match(publication, /default checkout selected in BB/, "the publication panel explains that BB's checkout choice is respected");
assert.match(
  publication,
  /cannot fetch remote updates, merge incoming changes, push, or create a pull request/,
  "the publication panel does not promise remote synchronization the BB API does not expose",
);
assert.match(publication, /Advanced Git operations/, "local squash integration is progressively disclosed");
assert.match(
  publication,
  /DisclosureChevron open=\{advancedGitOpen\} \/>Advanced Git operations/,
  "the disclosure arrow reads explicit open state, never CSS hope",
);
assert.match(publication, /publication\.pullRequest\.state === "draft" \? <Button/, "ready/draft resolves to one contextual action from PR state");
assert.match(publication, /Squash branch locally/, "local squash integration uses plain-language copy");
assert.match(publication, /Merge PR…/, "PR merge remains an explicit user action");
assert.match(actions, /submitting/, "publication confirmations prevent duplicate write requests");
assert.match(actions, /Repository rules,\s*approvals, checks, and merge queues remain authoritative/, "merge confirmation does not bypass repository policy");
assert.match(publication, /Publication history/, "the user can audit prior publication actions");
assert.match(
  commitDiff,
  /<details open=\{props\.open\}[\s\S]*Expand all[\s\S]*Collapse all[\s\S]*<CommitDiffFileActions[\s\S]*filesEpoch/,
  "commit files use controlled accordions with explicit expand and collapse actions",
);
assert.match(
  diff,
  /formatEntitySummary\(props\.diffData\.entitySummary\)[\s\S]*<p className="text-\[11px\] text-muted-foreground">\{entitySummary\}<\/p>/,
  "working-tree review renders the entity summary returned by presentation logic",
);
assert.match(
  diff,
  /formatChangedSymbols\(props\.diffData\.changedSymbols\)[\s\S]*title="Changed symbols with caller impact \(cymbal\)"[\s\S]*\{changedSymbols\}/,
  "working-tree review renders changed-symbol caller impact",
);
assert.match(
  diff,
  /const openFile = \(\) => props\.onOpenFile\(\{[\s\S]*target: fileLinkTarget\([\s\S]*onClick=\{openFile\}/,
  "patchless working-tree files open through the artifact viewer with an explicit click path",
);
assert.match(publication, /Next: publish the branch\./, "a saved commit names its pending step as structure, not buried prose");
assert.doesNotMatch(publication, /What remains to publish it/, "publish steps live as sections with action rows, never as buttons inside prose");
assert.doesNotMatch(publication, /Push the branch — this panel runs/, "no call-to-action hides inside a paragraph anymore");
assert.match(
  reviewTools,
  /shouldShowBuildDiff\(\{\s*status: card\.status,\s*stage: card\.stage,[\s\S]*publicationDirty: view\.publicationDirty,\s*recoveryKind:/,
  "the extracted Diff feature remains wired to card stage, dirty-tree state, and recovery state",
);
assert.match(reviewTools, /<BuildDiff[\s\S]*onOpenFile=\{view\.setViewerFile\}/, "working-tree files continue to open in the shared artifact viewer");
assert.match(publication, /Copy command/, "post-commit commands name what they copy instead of a bare Copy");
assert.match(publication, /Saved locally on/, "a successful local save has an explicit outcome state");
assert.match(publication, /View commit/, "recorded local commits can be inspected from Done");
assert.match(server, /parsePushRemoteUrl/, "the remote comes from git's own To line, never an assumed host");
assert.match(publication, /branchWebLinks/, "branch links are built from the parsed remote, not hardcoded");
assert.match(publication, /publication && \(pushed \|\| publication\.pullRequest\) \? branchWebLinks/, "remote links need a branch proven to exist remotely, never a failed first push");
assert.match(publication, /last push outcome unknown/, "an ended shell admits ignorance instead of claiming unpushed");
assert.match(publication, /On GitHub/, "a pushed branch links out to the remote it landed on");
assert.match(publication, /View branch ↗/, "the branch is one click away after pushing");
assert.match(publication, /Open pull request ↗/, "the next step after pushing is a link, not a paragraph");
assert.match(publication, /not pushed yet\./, "a saved commit states its remote truth instead of implying arrival");
assert.match(publication, /pushed to origin\./, "a finished push reads as published in the outcome line");
assert.match(publication, /Completed at \{verifiedHeadSha\.slice\(0, 7\)\}/, "completed cards anchor dirt to their verified HEAD");
assert.match(
  actions,
  /runPublicationMutation\(\{[\s\S]*refreshPublication: loadPublication,[\s\S]*refreshCard: onChanged/,
  "publication actions route both refreshes through the tested partial-failure lifecycle",
);
assert.match(publication, /setPushTerminals\(\{ ok: false, error:/, "push-shell listing failures stay visible instead of disappearing");
assert.match(publication, /action === "sync" \? \[10000, 25000\] : \[8000, 20000\]/, "push and sync results refresh automatically at their established follow-up times");
assert.match(
  actions,
  /else if \(action === "push" \|\| action === "sync"\) \{[\s\S]*?await loadPushTerminals\(\);\s*schedulePushRefresh\(action\);\s*\}/,
  "both remote publication paths refresh terminals immediately and schedule delayed refreshes",
);
assert.match(
  diff,
  /rpc\.call\("cardDiff", \{ cardId: props\.cardId \}\)/,
  "working-tree review loads the current card diff from the diff feature owner",
);
assert.match(
  diff,
  /if \(next && !diffData\) void loadDiff\(\)/,
  "working-tree diff loading stays lazy until disclosure opens",
);
assert.match(
  commitDiff,
  /rpc\.call\("publicationCommitDiff", \{ cardId, commitSha: sha \}\)/,
  "commit review loads the selected SHA for the current card from the diff feature owner",
);
assert.match(publication, /<CommitDiffReview[\s\S]*openCommit\(savedSha\)[\s\S]*openCommit\(event\.commitSha!\)/, "saved and historical commits both navigate through the diff feature owner");
assert.match(
  reviewTools,
  /<BuildPublication[\s\S]*onDirtyChange=\{view\.setPublicationDirty\}/,
  "Build detail delegates publication UI while observing dirty-tree state",
);
assert.doesNotMatch(readFileSync(join(root, "app.tsx"), "utf8"), /publicationPullRequestAction/, "Build detail no longer owns publication RPC actions");

console.log("publication wiring test ok: BB owns writes, Done stays separate, actions are explicit and auditable");
