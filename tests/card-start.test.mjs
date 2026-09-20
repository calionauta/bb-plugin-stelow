import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Deferred start: creating parks, starting is explicit. Defaults stay
// today's behavior (spawn on submit); nothing in the server forces an
// unstarted card — only the human unchecks the box.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");
const app = readFileSync(join(root, "app.tsx"), "utf8");
// GitHub issues live decoupled: the feature module owns matching,
// creation, scheduler, and RPCs; server.ts only wires the seam.
const githubServer = readFileSync(join(root, "server", "github-issues.ts"), "utf8");
const githubApp = readFileSync(join(root, "components", "github-issues-dialog.tsx"), "utf8");
const startCheck = readFileSync(join(root, "components", "start-immediately-check.tsx"), "utf8");

// Deferred start: creating spawns by default, and parks only where a human
// chose it. The automation path carries the rule's autostart flag (default
// off) instead of a literal — the human opts in per rule, the server never
// assumes.
assert.match(server, /start = true/, "creation spawns by default");
const forcedParks = server.match(/start: false/g) ?? [];
assert.equal(forcedParks.length, 0, "no hardcoded park remains — GitHub start policy comes from the human choice");
assert.match(githubServer, /start: decision\.start/, "automation passes the worktree-gated start policy through the shared GitHub path");
assert.match(server, /start: z\.boolean\(\)\.default\(true\)/, "the creation RPCs accept the human choice");
assert.match(server, /startWorker: \{/, "the start trigger is a named RPC");
assert.match(server, /async startWorker\(\{ cardId \}\)/, "the handler resolves the card");
assert.match(server, /spawnFreshWorker\(cardId, "start"\)/, "starting shares the fresh-spawn body");
assert.match(server, /return spawnFreshWorker\(cardId, "restart"\)/, "restart shares the same body — one spawn, never pasted");
assert.match(server, /Drag-to-Doing on a threadless card starts it/, "dragging inbox to Doing spawns instead of lying");
assert.match(server, /thread\?\.id \?\? null/, "an unstarted card stores a null thread, never a placeholder");

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
assert.equal(((app.match(/<StartImmediatelyCheck/g) ?? []).length + (githubApp.match(/<StartImmediatelyCheck/g) ?? []).length), 5, "build, research, explore, import, and automation dialogs all offer it");
assert.match(app, /rpc\.call\("createCard", \{[^}]*start: startImmediately/, "build submit passes the choice");
assert.match(app, /rpc\.call\("createResearchCard", \{[^}]*start: startImmediately/, "research submit passes the choice");
assert.match(app, /rpc\.call\("createExploreCard", \{[^}]*start: startImmediately/, "explore submit passes the choice");
assert.match(githubApp, /rpc\.call\("importGithubIssue", \{[^}]*start: importStart/, "import submit passes the choice");
assert.match(githubApp, /rpc\.call\("saveAutomationRule", \{[^}]*startImmediate: automationStart/, "rule creation passes the choice");
assert.match(githubApp, /rpc\.call\("previewAutomationRule"/, "rules offer a dry-run preview");
assert.match(githubApp, /rpc\.call\("listAutomationRuleRuns"/, "rules show their run history");
assert.match(githubServer, /seenKeys: seenAutomationKeys\(row\.id\)/, "the tick consults the backlog guard before matching");
assert.match(githubServer, /primed = await primeAutomationRule\(ruleId, projectId, clean, authors\)/, "enabling a rule primes the backlog without drafting");
assert.match(githubServer, /Rule saved disabled \(/, "a prime failure refuses live rules with the retry path named");
assert.equal((githubServer.match(/decideAutomationSpawn\(/g) ?? []).length, 2, "save and tick decide through one start-policy gate");
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
assert.match(app, /const \[startImmediately, setStartImmediately\] = useState\(true\)/, "new-issue dialogs default to started");
assert.match(githubApp, /const \[importStart, setImportStart\] = useState\(false\)/, "import defaults to parked");
assert.match(githubApp, /const \[automationStart, setAutomationStart\] = useState\(false\)/, "automation defaults to parked");
assert.equal((app.match(/rpc\.call\("startWorker"/g) ?? []).length, 3, "build, research, and explore cards all offer Start");
assert.match(app, /Not started — parked in Inbox/, "a parked card says plainly that nothing runs");
// The Inbox is the board's first column on every track, and leaving it is
// what starts a parked card (a build phase move spawns instead of lying).
assert.match(server, /const decision = resolveCardMove\(card\.kind, status, \{ hasWorker: Boolean\(card\.worker_thread_id\) \}\)/, "the move policy knows whether the card already started");
assert.match(server, /if \(!card\.worker_thread_id\) \{\s*const started = await spawnFreshWorker\(cardId, "start"\);/, "entering a build phase starts a parked card");
assert.match(server, /updateCard\(cardId, previous\)/, "a failed start reverts the phase instead of parking a lie");
assert.match(app, /function boardColumnOf\(card: Pick<CardItem, "status" \| "stage" \| "workerThreadId">\)/, "the board projection keeps thread state, so a parked card reaches the Inbox");

// Leaving the Inbox starts through the same starter on every track, and the
// starter resolves creation-time choices: the pinned preset override
// (provider/model) and the card's own project workspace — never ambient defaults.
assert.match(server, /const effective = getReliablePresetForBand\(/, "Inbox exits spawn through the override-aware preset resolution");
assert.match(server, /SELECT preset_id FROM card_presets WHERE card_id/, "a choice pinned at creation wins over band defaults at spawn");
assert.match(server, /const workspace = await cardWorkspace\(row\);/, "respawns run in the card's own project workspace");
assert.match(server, /if \(decision\.move\.status === "in-progress" && !card\.worker_thread_id\)/, "dragging a lightweight card to Doing starts it too");

// A Build workflow is code work: a Personal/exploratory folder only holds
// Stelow state and cannot truthfully produce a diff, branch, or commit.
assert.match(server, /Build cards require a project workspace with a Git source/, "new Build cards refuse an exploratory workspace");
assert.match(server, /Cannot split a Build workflow from an exploratory workspace/, "split cannot recreate an unverifiable Build child");
assert.match(server, /auditReceiptReadiness\(receiptContent/, "Build done checks the durable audit receipt before becoming Done");

// Automation rules live on the picker's project, not the board's: the Auto
// tab offers every project (the dialog opens from boards with none active),
// re-anchors on every open, and every rule RPC carries the picked id.
assert.match(githubApp, /label="Project for new rules"/, "the Auto tab offers a project picker");
assert.match(githubApp, /setRuleProjectId\(id\); setRulePreview\(null\); void refreshAutomationRules\(id\)/, "picking a project reloads its rules at once");
assert.match(githubApp, /const target = activeProjectId \?\? projects\[0\]\?\.id \?\? null;/, "opening re-anchors to the board project, else the first");
assert.match(githubApp, /rpc\.call\("saveAutomationRule", \{ projectId: ruleProjectId/, "saves carry the picked project");
assert.match(githubApp, /rpc\.call\("previewAutomationRule", \{ projectId: ruleProjectId/, "previews carry the picked project");
assert.match(githubApp, /rpc\.call\("listAutomationRules", \{ projectId \}/, "refresh carries its explicit project");
assert.doesNotMatch(githubApp, /projectId: activeProjectId/, "no rule RPC rides the ambient board project anymore");

// Shared filter fields: both tabs filter the same issue universe through
// one visual language (visible labels, h-11 controls, chips for label
// sets) instead of two dialects. A tab that grows its own filter copy
// fails here.
const githubFilters = readFileSync(join(root, "components", "github-filter-fields.tsx"), "utf8");
assert.match(githubApp, /from "\.\/github-filter-fields"/, "the dialog imports the shared fields");
assert.equal((githubApp.match(/<LabelChipsField/g) ?? []).length, 2, "import and auto tabs share the chips field");
assert.equal((githubApp.match(/<ProjectFilterSelect/g) ?? []).length, 2, "import and auto tabs share the project select");
assert.ok((githubFilters.match(/h-11/g) ?? []).length >= 3, "shared inputs, selects, and buttons share one control height");

// Label chips are the server query, not a client filter: editing them
// re-searches at once, so the list can never freeze on a removed label.
// An emptied set clears instead of erroring; the field explains the next
// step.
assert.match(githubApp, /onChange=\{\(next\) => \{ setImportLabels\(next\); void listGithubIssues\(next\); \}\}/, "import chip edits re-search with the new set");
assert.match(githubApp, /async function listGithubIssues\(explicit\?: string\[\]\)/, "the search accepts the explicit set, not just state");
assert.match(githubApp, /setImportCandidates\(\[\]\);\n\s*setImportSelected\(\{\}\);\n\s*return;/, "emptying the chips clears stale results without a fetch");
assert.match(githubApp, /onChange=\{\(next\) => \{ setAutomationLabels\(next\); setRulePreview\(null\); \}\}/, "auto chip edits invalidate the stale preview");

// The auto tab's scope picker is the same shared select in required mode:
// no "all", no ambient default, and switching projects reloads + clears
// the preview built for the previous scope.
assert.match(githubApp, /allowAll=\{false\}/, "rule scope never offers an all-projects escape");
assert.match(githubApp, /setRulePreview\(null\); void refreshAutomationRules\(id\)/, "switching rule project reloads and drops the old preview");

console.log("card start test ok: deferred start, shared spawn, split always starts");
