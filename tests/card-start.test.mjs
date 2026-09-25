import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Deferred start: creating parks, starting is explicit. Defaults stay
// today's behavior (spawn on submit); nothing in the server forces an
// unstarted card — only the human unchecks the box.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = [
  readFileSync(join(root, "server/plugin-runtime.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/card-operations.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/card-detail.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/worker-respawn-preparation.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/card-detail-presentation.ts"), "utf8"),
  readFileSync(join(root, "server/card-rpc-contract.ts"), "utf8"),
  readFileSync(join(root, "server/lifecycle-rpc-contract.ts"), "utf8"),
  readFileSync(join(root, "server/core-migrations.ts"), "utf8"),
].join("\n");
const cardsCreate = readFileSync(join(root, "server/cards-create.ts"), "utf8");
const cardsPersist = readFileSync(join(root, "server/cards-create-persist.ts"), "utf8");
const workers = readFileSync(join(root, "server/workers.ts"), "utf8");
const app = readFileSync(join(root, "app.tsx"), "utf8");
// GitHub issues live decoupled: the feature module owns matching,
// creation, scheduler, and RPCs; server.ts only wires the seam.
const githubServer = readFileSync(join(root, "server", "github-issues.ts"), "utf8");
const githubApp = readFileSync(join(root, "components", "github", "github-issues-dialog.tsx"), "utf8");
const buildDialog = readFileSync(join(root, "components", "creation", "create-build-dialog.tsx"), "utf8");
const buildPanelDialogs = readFileSync(join(root, "components", "panels", "build-panel-dialogs.tsx"), "utf8");
const researchPanelDialogs = readFileSync(join(root, "components", "panels", "research-panel-dialogs.tsx"), "utf8");
const explorePanelDialogs = readFileSync(join(root, "components", "panels", "explore-panel-dialogs.tsx"), "utf8");
const workflowVocabulary = readFileSync(join(root, "lib", "workflow-vocabulary.mjs"), "utf8");
const researchDialog = readFileSync(join(root, "components", "creation", "create-research-dialog.tsx"), "utf8");
const exploreDialog = readFileSync(join(root, "components", "creation", "create-explore-dialog.tsx"), "utf8");
const githubImport = readFileSync(join(root, "components", "github", "github-import-tab.tsx"), "utf8");
const githubAuto = readFileSync(join(root, "components", "github", "github-automation-tab.tsx"), "utf8");
const githubState = readFileSync(join(root, "components", "github", "github-dialog-state.ts"), "utf8");
const githubChrome = readFileSync(join(root, "components", "github", "github-dialog-chrome.tsx"), "utf8");
const startCheck = readFileSync(join(root, "components", "start-immediately-check.tsx"), "utf8");
const heroActions = readFileSync(join(root, "components", "detail", "detail-hero-actions.tsx"), "utf8");
const researchState = readFileSync(join(root, "components", "detail", "use-research-detail-state.ts"), "utf8");
const exploreState = readFileSync(join(root, "components", "detail", "use-explore-detail-state.ts"), "utf8");
const buildLifecycleState = readFileSync(join(root, "components", "detail", "use-build-detail-lifecycle.ts"), "utf8");
const detailStartSource = `${app}\n${researchState}\n${exploreState}\n${buildLifecycleState}`;

// Deferred start: creating spawns by default, and parks only where a human
// chose it. The automation path carries the rule's autostart flag (default
// off) instead of a literal — the human opts in per rule, the server never
// assumes.
assert.match(cardsCreate, /input\.start === false/, "creation parks only when the human opts out");
const forcedParks = server.match(/start: false/g) ?? [];
assert.equal(forcedParks.length, 0, "no hardcoded park remains — GitHub start policy comes from the human choice");
assert.match(githubServer, /start: decision\.start/, "automation passes the worktree-gated start policy through the shared GitHub path");
assert.match(server, /start: z\.boolean\(\)\.default\(true\)/, "the creation RPCs accept the human choice");
assert.match(server, /startWorker: \{/, "the start trigger is a named RPC");
assert.match(server, /function startWorker\(/, "the handler resolves the card");
assert.match(workers, /async function fresh\(/, "the worker seam owns the fresh-spawn body");
assert.match(server, /deps\.workers\.fresh\(cardId, "start"\)/, "starting shares the fresh-spawn body");
assert.match(server, /deps\.workers\.fresh\(cardId, "restart"\)/, "restart shares the same body — one spawn, never pasted");
assert.match(server, /status === "in-progress" && !card\.worker_thread_id/, "dragging inbox to Doing spawns instead of lying");
assert.match(cardsPersist, /thread\?\.id \?\? null/, "an unstarted card stores a null thread, never a placeholder");

// Split children are approved work: they inherit the spawn default and
// never park. The split spawn call carries no start key at all.
const splitAt = server.indexOf("Split from");
assert.notEqual(splitAt, -1, "the split executor exists");
const splitCall = server.slice(splitAt, splitAt + 1200);
assert.ok(!splitCall.includes("start"), "split children inherit start-by-default — approved work never parks");

// The dialogs offer the choice (checked by default); threadless cards
// offer Start in place of thread-bound actions. Every track offers it —
// Build included, so no track can only be created running.
assert.match(startCheck, /function StartImmediatelyCheck/, "one checkbox component serves every creation dialog");
assert.equal(((buildDialog.match(/<StartImmediatelyCheck/g) ?? []).length + (researchDialog.match(/<StartImmediatelyCheck/g) ?? []).length + (exploreDialog.match(/<StartImmediatelyCheck/g) ?? []).length + (githubImport.match(/<StartImmediatelyCheck/g) ?? []).length + (githubAuto.match(/<StartImmediatelyCheck/g) ?? []).length), 5, "build, research, explore, import, and automation dialogs all offer it");
// The word rides the board label map, never a pasted string — renaming the
// concept again is one line. The creation checkboxes link to their pile's
// gallery; the GitHub dialogs (no pile in scope) render plain text.
assert.match(startCheck, /BUILD_BOARD_COLUMN_LABELS\[BUILD_BOARD_INBOX\]/, "the checkbox names the column from the label map");
assert.doesNotMatch(startCheck, /park in Inbox/, "no pasted Inbox survives in the checkbox copy");
assert.equal(((buildDialog.match(/onViewBucket=\{bucketGallery\.openBucketGallery\}/g) ?? []).length + (researchDialog.match(/onViewBucket=\{bucketGallery\.openBucketGallery\}/g) ?? []).length + (exploreDialog.match(/onViewBucket=\{bucketGallery\.openBucketGallery\}/g) ?? []).length), 3, "build, research, and explore checkboxes link to their galleries");
assert.equal(((githubImport.match(/onViewBucket/g) ?? []).length + (githubAuto.match(/onViewBucket/g) ?? []).length), 0, "import and automation checkboxes render the plain word");
assert.match(buildDialog, /rpc\.call\("createCard", \{[^}]*start: startImmediately/, "build submit passes the choice");
// Build creation: one dialog component owns draft, intent, error, and
// start — the panel keeps the open flag plus board defaults.
assert.match(buildDialog, /export function CreateBuildDialog\(\{ open, onOpenChange, activeProjectId, analysisPreset/, "the build dialog lives in the creation module");
assert.match(buildPanelDialogs, /import \{ CreateBuildDialog \} from "\.\.\/creation\/create-build-dialog"/, "the board panel reads the shared dialog");
assert.doesNotMatch(app, /rpc\.call\("createCard",/, "no local build submit survives in the panel");
assert.match(buildDialog, /function handleOpenChange\(next: boolean\) \{\s*\n\s*onOpenChange\(next\);\s*\n\s*if \(next\) submit\.resetOnOpen\(\);/, "every open resets to started with a clean error");
assert.match(buildDialog, /function resetOnOpen\(\) \{[\s\S]*setStartImmediately\(true\);[\s\S]*setCreateGithubIssue\(false\);[\s\S]*setCreateGithubRepo\(null\);[\s\S]*setError\(null\);/, "reset restores started default, GitHub opt-in state, and clears the error");
assert.match(researchDialog, /rpc\.call\("createResearchCard", \{[^}]*start: startImmediately/, "research submit passes the choice");
// Research creation: one dialog component owns draft, strategy, error,
// and start — the panel keeps the open flag plus the strategy catalog.
assert.match(researchDialog, /export function CreateResearchDialog\(\{ open, onOpenChange, activeProjectId, strategies, researchPreset/, "the research dialog lives in the creation module");
assert.match(
  researchPanelDialogs,
  /import \{ CreateResearchDialog \} from "\.\.\/creation\/create-research-dialog"/,
  "the research panel reads the shared dialog",
);
assert.doesNotMatch(app, /rpc\.call\("createResearchCard",/, "no local research submit survives in the panel");
assert.match(researchDialog, /function resetOnOpen\(\) \{\s*\n\s*setStrategy\(null\);\s*\n\s*setStartImmediately\(true\);\s*\n\s*setError\(null\);/, "every open resets strategy, start, and error");
assert.match(exploreDialog, /rpc\.call\("createExploreCard", \{[^}]*start: startImmediately/, "explore submit passes the choice");
// Explore creation: one dialog component owns draft, stage, error, and
// start — the panel keeps the open flag plus the technique catalog.
assert.match(exploreDialog, /export function CreateExploreDialog\(\{ open, onOpenChange, activeProjectId, stages, explorePreset/, "the explore dialog lives in the creation module");
assert.ok(
  explorePanelDialogs.includes('import { CreateExploreDialog } from "../creation/create-explore-dialog"'),
  "the board panel reads the shared explore dialog",
);
assert.doesNotMatch(app, /rpc\.call\("createExploreCard",/, "no local explore submit survives in the panel");
assert.match(exploreDialog, /function resetOnOpen\(\) \{\s*\n\s*setStage\(null\);\s*\n\s*setStartImmediately\(true\);\s*\n\s*setError\(null\);/, "every open resets stage, start, and error");
assert.match(githubState, /rpc\.call\("importGithubIssue", \{[^}]*start: importStart/, "import submit passes the choice");
assert.match(githubImport, /<IsolatedWorktreeCheck checked=\{importIsolated\} onChange=\{setImportIsolated\} \/>/, "import offers the shared isolated toggle");
assert.match(githubState, /isolated: importIsolated \}\)/, "import submit passes isolation");
assert.doesNotMatch(githubImport, /separate copy/, "the toggle copy lives in one component, never pasted in the dialog");
const disclosure = readFileSync(join(root, "components", "disclosure.tsx"), "utf8");
assert.match(disclosure, /export function DisclosureChevron/, "the chevron lives in one shared module");
assert.match(disclosure, /export function DetailsDisclosure/, "progressive disclosure is one convention, not ad-hoc details");
const managerShell = readFileSync(join(root, "components/settings/preset-manager-shell.tsx"), "utf8");
assert.match(managerShell, /import \{ DisclosureSection \} from "\.\.\/disclosure"/, "the manager shell reads the shared disclosure section");
assert.doesNotMatch(app, /function DisclosureChevron\(/, "no local chevron copy survives in the panel");
assert.match(disclosure, /export function DisclosureSection/, "the section lives in the shared disclosure module");
assert.doesNotMatch(disclosure, /CardDisclosure/, "the legacy card name is migrated, never aliased");
assert.doesNotMatch(app, /CardDisclosure/, "no legacy card name survives in the panel");
assert.doesNotMatch(app, /function DisclosureSection\(/, "no local section copy survives in the panel");
assert.match(readFileSync(join(root, "components", "isolated-worktree-check.tsx"), "utf8"), /<DetailsDisclosure summary="How it works">/, "the toggle discloses progressively");
assert.match(githubServer, /presetId = resolveWorktreePreset\(\);/, "isolated import resolves the worktree preset");
assert.match(githubServer, /Isolated start refused:/, "missing isolation refuses with the redirect, never silent checkout");
assert.match(
  githubServer,
  /ctx\.presets\.pinCardPreset\(created\.cardId, presetId\)/,
  "parked isolated imports pin their preset for the later Start",
);
assert.match(server, /pinCardPreset,/, "the runtime injects the tested preset pin into GitHub import");
assert.match(githubState, /rpc\.call\("saveAutomationRule", \{[^}]*startImmediate: automationStart/, "rule creation passes the choice");
assert.match(githubState, /rpc\.call\("previewAutomationRule"/, "rules offer a dry-run preview");
assert.match(githubState, /rpc\.call\("listAutomationRuleRuns"/, "rules show their run history");
assert.match(githubServer, /seenKeys: seenAutomationKeys\(row\.id\)/, "the tick consults the backlog guard before matching");
assert.match(githubServer, /primed = await primeAutomationRule\(ruleId, projectId, clean, authors\)/, "enabling a rule primes the backlog without drafting");
assert.match(githubServer, /Rule saved disabled \(/, "a prime failure refuses live rules with the retry path named");
assert.equal((githubServer.match(/decideAutomationSpawn\(/g) ?? []).length, 3, "save, tick, and isolated import decide through one start-policy gate");
assert.match(githubServer, /acquireGithubImportClaim\(db,/, "creation goes through the claim protocol, never check-then-insert");
assert.doesNotMatch(githubServer, /INSERT OR REPLACE INTO github_imports/, "the racing upsert shape is gone");
assert.equal((githubServer.match(/liveImportedKeys\(db\)/g) ?? []).length, 3, "tick, prime, and preview delegate liveness to lib");
assert.match(githubServer, /claimed_by = NULL WHERE issue_key = \?/, "a lost claim links our card unconditionally instead of orphaning a second one");
assert.match(githubServer, /carriesMarker\(before\.issue\.comments, marker\)/, "a pre-existing marker is adopted, never re-posted");
assert.doesNotMatch(githubServer, /alreadyImported: Boolean\(link\)/, "the cardless-counts-as-imported shape is gone");
assert.match(githubServer, /const marker = markerFor\(cardId\)/, "write-back markers come from lib, never an inline literal");
assert.match(githubServer, /carriesMarker\(after\.issue\.comments, marker\)/, "posted output is verified back on the remote");
assert.match(githubServer, /GitHub issues are disabled on this host \(STELOW_GITHUB_ISSUES=0\)/, "disabled RPCs name the variable");
assert.match(server, /STELOW_GITHUB_ISSUES/, "server.ts only names the switch, never its logic");
assert.match(server, /\.\.\.github\.handlers/, "server.ts only spreads the feature handlers");
assert.match(server, /runGithubMigrations\(db\)/, "server.ts delegates the feature migrations in one call");
assert.doesNotMatch(githubServer, /card_id, fired_at\) VALUES/, "fires rows always carry their outcome");
// environment_label is pinned by count in card-insert-contract (25
// columns); checkout and outcome copy render from contract-typed data,
// so no copy pins here.
// Same checkbox, per-dialog default: creation dialogs start checked,
// GitHub flows park unchecked.
assert.match(buildDialog, /const \[startImmediately, setStartImmediately\] = useState\(true\)/, "new-issue dialogs default to started");
assert.equal(((buildDialog.match(/setStartImmediately\] = useState\(true\)/g) ?? []).length + (researchDialog.match(/setStartImmediately\] = useState\(true\)/g) ?? []).length + (exploreDialog.match(/setStartImmediately\] = useState\(true\)/g) ?? []).length), 3, "build, research, and explore creation default to started");
assert.match(githubState, /const \[importStart, setImportStart\] = useState\(false\)/, "import defaults to parked");
assert.match(githubState, /const \[automationStart, setAutomationStart\] = useState\(false\)/, "automation defaults to parked");
assert.equal((detailStartSource.match(/rpc\.call\("startWorker"/g) ?? []).length, 3, "build, research, and explore cards all offer Start");
assert.match(heroActions, /Not started — parked in Bucket/, "a parked card says plainly that nothing runs");
// The Bucket is the board's first column on every track, and leaving it is
// what starts a parked card (a build phase move spawns instead of lying).
assert.match(
  server,
  /const decision = resolveCardMove\(\s*card\.kind,\s*status,\s*\{\s*hasWorker: Boolean\(card\.worker_thread_id\),\s*\}\s*\)/,
  "the move policy knows whether the card already started",
);
const parkedStart = /if \(card\.worker_thread_id\) return[\s\S]*?const started = await deps\.workers\.fresh\(cardId, "start"\);/;
assert.match(server, parkedStart, "entering a build phase starts a parked card");
assert.match(server, /deps\.updateCard\(cardId, previous\)/, "a failed start reverts the phase instead of parking a lie");
assert.match(workflowVocabulary, /export function buildBoardColumnFor\(card\)/, "the board projection keeps thread state, so a parked card reaches the Bucket");

// Leaving the Bucket starts through the same starter on every track, and the
// starter resolves creation-time choices: the pinned preset override
// (provider/model) and the card's own project workspace — never ambient defaults.
assert.match(server, /const effective = getReliablePresetForBand\(/, "Bucket exits spawn through the override-aware preset resolution");
assert.match(server, /SELECT preset_id FROM card_presets WHERE card_id/, "a choice pinned at creation wins over band defaults at spawn");
assert.match(
  server,
  /const workspace = await deps\.cardWorkspace\(card\);/,
  "respawns run in the card's own project workspace",
);
assert.match(
  server,
  /if \(\s*status === "in-progress" && !card\.worker_thread_id\s*\)/,
  "dragging a lightweight card to Doing starts it too",
);

// A Build workflow is code work: a Personal/exploratory folder only holds
// Stelow state and cannot truthfully produce a diff, branch, or commit.
assert.match(cardsCreate, /Build cards require a project workspace with a Git source/, "new Build cards refuse an exploratory workspace");
assert.match(server, /Cannot split a Build workflow from an exploratory workspace/, "split cannot recreate an unverifiable Build child");
assert.match(
  server,
  /auditReceiptReadiness\(\s*receiptContent/,
  "Build done checks the durable audit receipt before becoming Done",
);

// Automation rules live on the picker's project, not the board's: the Auto
// tab offers every project (the dialog opens from boards with none active),
// re-anchors on every open, and every rule RPC carries the picked id.
assert.match(githubAuto, /label="Project for new rules"/, "the Auto tab offers a project picker");
assert.match(githubAuto, /setRuleProjectId\(id\); setRulePreview\(null\); void refreshAutomationRules\(id\)/, "picking a project reloads its rules at once");
assert.match(githubState, /const target = activeProjectId \?\? projects\[0\]\?\.id \?\? null;/, "opening re-anchors to the board project, else the first");
assert.match(githubState, /rpc\.call\("saveAutomationRule", \{ projectId: ruleProjectId/, "saves carry the picked project");
assert.match(githubState, /rpc\.call\("previewAutomationRule", \{ projectId: ruleProjectId/, "previews carry the picked project");
assert.match(githubState, /rpc\.call\("listAutomationRules", \{ projectId \}/, "refresh carries its explicit project");
assert.doesNotMatch(githubState, /projectId: activeProjectId/, "no rule RPC rides the ambient board project anymore");
assert.match(githubChrome, /Add rule to <span/, "the save names its project — carried-over labels can never land silently");

// Shared filter fields: both tabs filter the same issue universe through
// one visual language (visible labels, h-11 controls, chips for label
// sets) instead of two dialects. A tab that grows its own filter copy
// fails here.
const githubFilters = readFileSync(join(root, "components", "github-filter-fields.tsx"), "utf8");
assert.match(githubImport, /from "\.\.\/github-filter-fields"/, "the import tab reads the shared fields");
assert.match(githubAuto, /from "\.\.\/github-filter-fields"/, "the auto tab reads the shared fields");
assert.equal((githubImport.match(/<LabelChipsField/g) ?? []).length, 1, "the import tab renders one chips field");
assert.equal((githubAuto.match(/<LabelChipsField/g) ?? []).length, 1, "the auto tab renders one chips field");
assert.equal((githubImport.match(/<ProjectFilterSelect/g) ?? []).length, 1, "the import tab renders one project select");
assert.equal((githubAuto.match(/<ProjectFilterSelect/g) ?? []).length, 1, "the auto tab renders one project select");
assert.ok((githubFilters.match(/h-11/g) ?? []).length >= 3, "shared inputs, selects, and buttons share one control height");

// Label chips are the server query, not a client filter: editing them
// re-searches at once, so the list can never freeze on a removed label.
// An emptied set clears instead of erroring; the field explains the next
// step.
assert.match(githubImport, /onChange=\{\(next\) => \{ setImportLabels\(next\); void listGithubIssues\(next\); \}\}/, "import chip edits re-search with the new set");
assert.match(githubState, /async function listGithubIssues\(explicit\?: string\[\]\)/, "the search accepts the explicit set, not just state");
// Narrowing and preselect live in lib (tested): the hook delegates.
assert.match(githubState, /filterImportCandidates<GithubCandidate>\(importCandidates/, "narrowing delegates to the tested lib helper");
assert.match(githubState, /setImportSelected\(preselectFreshIssues\(result\.issues\)\)/, "preselect delegates to the tested lib helper");
assert.match(githubState, /setImportCandidates\(\[\]\);\n\s*setImportSelected\(\{\}\);\n\s*return;/, "emptying the chips clears stale results without a fetch");
assert.match(githubAuto, /onChange=\{\(next\) => \{ setAutomationLabels\(next\); setRulePreview\(null\); \}\}/, "auto chip edits invalidate the stale preview");

// The auto tab's scope picker is the same shared select in required mode:
// no "all", no ambient default, and switching projects reloads + clears
// the preview built for the previous scope.
assert.match(githubAuto, /allowAll=\{false\}/, "rule scope never offers an all-projects escape");
assert.match(githubAuto, /setRulePreview\(null\); void refreshAutomationRules\(id\)/, "switching rule project reloads and drops the old preview");

// Authors allowlist and worker instructions are rule scope, not import
// filters: they shape what a rule drafts, so they render once, in the
// Auto tab. The import tab narrows with assignee instead.
assert.equal((githubAuto.match(/Only these authors/g) ?? []).length, 1, "the authors allowlist exists once, in rule scope");
assert.equal((githubAuto.match(/Worker instructions/g) ?? []).length, 1, "worker instructions exist once, in rule scope");

// Dialog tabs are a real tablist (panels switch in place): roles,
// roving tabindex, arrows/Home/End. The board stays a nav (aria-current,
// routed views) and inbox filters stay pressed buttons — same look,
// three different contracts, documented at the component.
assert.match(githubChrome, /role="tablist" aria-label="GitHub sections"/, "dialog tabs announce as a tablist");
assert.match(githubChrome, /role="tab"[\s\S]*?aria-selected=\{tab === entry\}/, "tabs expose selection, not pressed state");
assert.match(githubChrome, /tabIndex=\{tab === entry \? 0 : -1\}/, "roving tabindex keeps one tab stop");
assert.match(githubChrome, /event\.key === "ArrowRight"/, "arrow keys move between tabs");
assert.match(githubApp, /role="tabpanel" id=\{`github-panel-\$\{githubTab\}`\}/, "the visible panel is labelled by its tab");
assert.match(githubChrome, /Deliberately NOT the board's nav pattern/, "the three-pattern split is documented, not accidental");

console.log("card start test ok: deferred start, shared spawn, split always starts");
