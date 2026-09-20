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
assert.match(githubServer, /automation_rule_seen/, "backlog guard has its own table");
assert.match(githubServer, /primeAutomationRule/, "enabling a rule primes the backlog without drafting");
assert.match(githubServer, /resolveWorktreePreset/, "auto-start resolves an isolated preset first");
assert.match(githubServer, /decideAutomationSpawn/, "start policy decides from the effective spawn environment");
assert.match(githubServer, /claimed_by/, "concurrent imports claim before working");
assert.match(githubServer, /liveImportedKeys/, "cardless imports read as not-imported");
assert.match(githubServer, /stelow:card=/, "write-back carries a verifiable marker");
assert.match(githubServer, /commentCarriesMarker/, "write-back verifies instead of trusting the send");
assert.match(githubServer, /applyRulePrompt/, "rule templates thread into the issue prompt");
assert.match(githubServer, /findRelatedIssues/, "candidates warn about possibly-related issues");
assert.match(githubServer, /githubIssuesEnabled/, "the feature carries its own kill switch");
assert.match(server, /STELOW_GITHUB_ISSUES/, "server.ts only names the switch, never its logic");
assert.match(server, /\.\.\.github\.handlers/, "server.ts only spreads the feature handlers");
assert.match(server, /runGithubMigrations\(db\)/, "server.ts delegates the feature migrations in one call");
assert.match(server, /environment_label/, "cards record their spawn environment in one word");
assert.match(server, /outcome/, "automation runs record their outcome");
assert.match(app, /checkoutNoteFor/, "open cards name their checkout and branch");
assert.match(githubApp, /RULE_RUN_OUTCOME/, "run history names each outcome in plain words");
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
assert.match(server, /const effective = getPresetForBand\(/, "Inbox exits spawn through the override-aware preset resolution");
assert.match(server, /SELECT preset_id FROM card_presets WHERE card_id/, "a choice pinned at creation wins over band defaults at spawn");
assert.match(server, /const workspace = await cardWorkspace\(row\);/, "respawns run in the card's own project workspace");
assert.match(server, /if \(decision\.move\.status === "in-progress" && !card\.worker_thread_id\)/, "dragging a lightweight card to Doing starts it too");

// A Build workflow is code work: a Personal/exploratory folder only holds
// Stelow state and cannot truthfully produce a diff, branch, or commit.
assert.match(server, /Build cards require a project workspace with a Git source/, "new Build cards refuse an exploratory workspace");
assert.match(server, /Cannot split a Build workflow from an exploratory workspace/, "split cannot recreate an unverifiable Build child");
assert.match(server, /auditReceiptReadiness\(receiptContent/, "Build done checks the durable audit receipt before becoming Done");

console.log("card start test ok: deferred start, shared spawn, split always starts");
