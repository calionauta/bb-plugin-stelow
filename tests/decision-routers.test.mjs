import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Decision routers wiring: one settings block (endpoint + key + model),
// per-point modes, and a single execution seam at card creation. The test
// that would catch a regression that leaks the key, bypasses the mode gate,
// or acts on unconfigured points.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = [
  readFileSync(join(root, "server.ts"), "utf8"),
  readFileSync(join(root, "server/plugin-runtime.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/build-thread-sync.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/reconciler.ts"), "utf8"),
  readFileSync(join(root, "server/cards-create.ts"), "utf8"),
].join("\n");
const decisionServer = readFileSync(join(root, "server", "decision-api.ts"), "utf8");
const decisionSeams = readFileSync(join(root, "server", "decision-api-seams.ts"), "utf8");
const decisionContract = readFileSync(join(root, "server", "decision-api-contract.ts"), "utf8");
const app = readFileSync(join(root, "app.tsx"), "utf8");
const managerShell = readFileSync(join(root, "components/settings/preset-manager-shell.tsx"), "utf8");
const decisionEntry = readFileSync(join(root, "components/settings/decision-api.tsx"), "utf8");
const decisionApiUi = readFileSync(join(root, "components/settings/decision-api-section.tsx"), "utf8");
const decisionRouterUi = readFileSync(join(root, "components/settings/decision-router-row.tsx"), "utf8");
const cliRegistry = readFileSync(join(root, "server/runtime/cli-registry.ts"), "utf8");
const decisionRoutersUi = readFileSync(join(root, "components/settings/decision-routers-section.tsx"), "utf8");

function handlerBody(name) {
  const at = decisionServer.indexOf(name);
  assert.ok(at >= 0, `${name} exists in the decision API module`);
  const end = decisionServer.indexOf("\n    },\n", at);
  assert.ok(end > at, `${name} body is bounded`);
  return decisionServer.slice(at, end);
}

// Singleton config table + per-point table with a closed mode set. Absent
// rows mean unconfigured — new registry points need no migration.
assert.match(
  decisionServer,
  /CREATE TABLE IF NOT EXISTS decision_api_config \(\s*\n\s*id INTEGER PRIMARY KEY CHECK \(id = 1\)/,
  "the API settings are one singleton row",
);
assert.match(decisionServer, /CREATE TABLE IF NOT EXISTS decision_points \(\s*\n\s*point TEXT PRIMARY KEY,/, "points key by registry id");
assert.match(decisionServer, /mode TEXT NOT NULL CHECK \(mode IN \('rules', 'api', 'preset'\)\)/, "stored modes are closed to rules/api/preset");
assert.match(decisionServer, /preset_id TEXT,/, "points pin an optional judge preset");
assert.match(
  decisionServer,
  /INSERT OR IGNORE INTO decision_points_new \(point, mode, thresholds, updated_at\) SELECT/,
  "older tables rebuild to widen the mode check without losing rows",
);

// Contract entries exist for every handler (a handler without one fails
// typecheck; the getter/setter pair must stay in lockstep).
for (const name of ["getDecisionApiConfig", "setDecisionApiConfig", "testDecisionApi", "getDecisionPoint", "setDecisionPoint", "listDecisionPoints"]) {
  assert.match(decisionContract, new RegExp(`  ${name}: \\{`), `${name} is in the module RPC contract`);
}
for (const name of ["getDecisionApiConfig", "listDecisionPoints", "testDecisionApi"]) {
  assert.match(decisionServer, new RegExp(`async ${name}\\(\\) \\{`), `${name} handler exists`);
}
for (const name of ["setDecisionApiConfig", "getDecisionPoint", "setDecisionPoint"]) {
  assert.match(decisionServer, new RegExp(`async ${name}\\(\\{`), `${name} handler exists`);
}

// The key never leaves the host: reads report presence + source only.
const configBody = handlerBody("async getDecisionApiConfig() {");
assert.ok(configBody.includes("hasKey: key !== null"), "reads report key presence, not the key");
assert.ok(configBody.includes("keySource"), "reads report where the key came from");
assert.ok(configBody.includes("resolveDecisionApiKey"), "reads resolve through the single key cascade");
// Negative pin: the raw key must never ride the return. The body legitimately
// reads row.api_key (SELECT + cascade input), so the ban scopes to the
// returned object — adding api_key to the return fails here.
const configReturnAt = configBody.indexOf("return {");
assert.ok(configReturnAt >= 0, "the getter return is found");
assert.ok(!configBody.slice(configReturnAt).includes("api_key"), "the getter return never carries the raw key");

// Setter validates the endpoint at the boundary and distinguishes keep
// (absent) from clear (null) for the key.
const setterBody = handlerBody("async setDecisionApiConfig(");
assert.ok(setterBody.includes("must be an http(s) URL"), "bad endpoints refuse with the fix named");
assert.ok(setterBody.includes("apiKey === undefined"), "an absent key keeps the stored one");
assert.ok(setterBody.includes("(apiKey ??"), "an explicit null clears the stored one");

// The probe is the only on-demand spend: fixed question, latency reported.
const probeBody = handlerBody("async testDecisionApi() {");
assert.ok(probeBody.includes("evaluateDecisionCall({"), "the probe calls through the shared client");
assert.ok(probeBody.includes("No key: set one in Decision API settings or export DECISION_API_KEY."), "a keyless probe refuses with the setup named");
assert.ok(probeBody.includes("latencyMs"), "probes report latency");

// Kill switch (STELOW_DECISION_API=0, blueprint §7): reads degrade, api
// writes and probes refuse naming the variable, and the seam short-circuits
// before any config read — operators block outbound calls host-wide.
assert.ok(probeBody.includes("STELOW_DECISION_API=0"), "probes refuse naming the variable");
assert.match(decisionContract, /disabled: z\.boolean\(\)/, "the config contract carries the disabled flag");
assert.ok(configBody.includes("disabled: isDecisionApiDisabled(process.env)"), "reads report the disabled flag");
assert.ok(configBody.includes("configured: row !== undefined"), "reads report whether anything was ever saved (defaults vs configured)");
// Provider adapters: the config row carries a provider with a jev default
// for pre-adapter installs; unknown names refuse with the valid set.
assert.match(decisionServer, /ADD COLUMN provider TEXT NOT NULL DEFAULT 'jev'/, "pre-adapter installs migrate with the jev default");
assert.match(
  decisionContract,
  /provider: z\.string\(\)\.max\(20\)\.nullable\(\)\.optional\(\)/,
  "the setter input carries the provider (strict would drop it otherwise)",
);
assert.ok(setterBody.includes("Unknown provider"), "unknown providers refuse");
assert.ok(setterBody.includes("DECISION_PROVIDERS.map((entry) => entry.id).join"), "provider refusals name the valid set");

// Point writes refuse unknown ids and modes with the valid set named;
// preset mode additionally refuses hot paths and unknown presets at save
// time, so a misconfigured point never silently degrades at use time.
// Reads degrade to registry defaults instead of refusing.
const pointSetter = handlerBody("async setDecisionPoint(");
assert.ok(pointSetter.includes("Unknown decision point"), "unknown points refuse");
assert.ok(pointSetter.includes("Available: ${DECISION_POINTS"), "point refusals name the valid set");
assert.ok(pointSetter.includes("Unknown mode"), "unknown modes refuse");
assert.ok(pointSetter.includes("STELOW_DECISION_API=0"), "api-mode writes refuse naming the variable");
assert.ok(pointSetter.includes("cannot judge via preset"), "hot paths refuse preset mode with the cost reason");
assert.ok(pointSetter.includes("Preset mode needs a judge preset"), "preset mode without a preset refuses in user words, never an id");
assert.ok(pointSetter.includes("Unknown preset"), "preset mode with a missing preset refuses");
assert.ok(pointSetter.includes("const existing = pointRow(point)"), "flipping modes reads the stored row");
assert.ok(pointSetter.includes("route === undefined"), "absent route parameters preserve stored route fields");
assert.ok(pointSetter.includes("presetId === undefined"), "absent preset parameters preserve the stored judge");
const pointGetter = handlerBody("async getDecisionPoint(");
assert.ok(pointGetter.includes("pointView("), "single and list reads share one normalized point view");
assert.ok(decisionServer.includes("normalizePointMode(row?.mode"), "reads normalize unknown modes to rules");
const listBody = handlerBody("async listDecisionPoints() {");
assert.ok(listBody.includes("DECISION_POINTS.map("), "the list derives from the registry — never a pasted copy");
assert.ok(listBody.includes("rules: def.rules"), "the list exposes what built-in rules do per point");
assert.ok(listBody.includes("requires: def.requires ?? null"), "the list exposes provider requirements");

// Execution seam: build creations consult the router exactly once, and the
// router fails soft to "unknown" on every path (mode gate, missing key,
// catch-all) so creation never breaks for a misconfigured point.
assert.match(
  server,
  /explicitIntent !== "unknown" \? explicitIntent\s*:\s*await deps\.seedBuildIntent\(input\.prompt, workspace\.projectId\)/,
  "explicit caller intent wins; otherwise the router seeds with the card project, else triage settles",
);
const seamAt = decisionSeams.indexOf("async function seedBuildIntent(\n");
assert.ok(seamAt >= 0, "the router seam exists in the decision API module");
const seamEnd = decisionSeams.indexOf("\n  }\n", seamAt);
assert.ok(seamEnd > seamAt, "the router seam body is bounded");
const seamBody = decisionSeams.slice(seamAt, seamEnd);
assert.ok(seamBody.includes("return \"unknown\""), "disabled triage seeds stay unknown");
assert.ok(seamBody.includes('normalizePointMode(point?.mode, "rules")'), "unconfigured points default to rules — a fallback flip to api fails here");
assert.ok(decisionSeams.includes("resolveSeedIntent({"), "seeding resolves through the lib cascade");
assert.ok(decisionSeams.includes("triage intent seeded from Decision API"), "api seeds leave a log trail with the outcome");
assert.ok(decisionSeams.includes("triage intent router fell back to built-in rules"), "api failures log the fallback instead of failing silently");
assert.ok(decisionSeams.includes("isDecisionApiDisabled(process.env)"), "the seam consults the kill switch first");
assert.ok(decisionSeams.includes("provider,"), "the seam forwards the configured provider");
assert.ok(probeBody.includes("buildProbeCall(provider)"), "the probe speaks the provider's native shape");

// Auto-continue veto wiring: the heuristic still owns the resume decision;
// the router only vetoes confident chatter. Guards that disappear here
// would silently spend worker turns — each is pinned.
const pointsLib = readFileSync(join(root, "lib", "decision-points.mjs"), "utf8");
assert.match(pointsLib, /id: DECISION_POINT_AUTO_CONTINUE,/, "the auto-continue point is registered");
assert.ok(pointsLib.includes('defaultThresholds: { routeAt: 0.7 }'), "the veto floor prices worker turns above the free triage seed");
const vetAt = decisionSeams.indexOf("async function vetAutoContinue(");
assert.ok(vetAt >= 0, "the veto seam exists in the decision API module");
assert.ok(decisionSeams.includes("pointRow(DECISION_POINT_AUTO_CONTINUE)"), "the veto reads its own point row through the feature seam");
const vetEnd = decisionSeams.indexOf("\n  }\n", vetAt);
assert.ok(vetEnd > vetAt, "the veto seam body is bounded");
const vetBody = decisionSeams.slice(vetAt, vetEnd);
assert.ok((vetBody.match(/return true/g) ?? []).length >= 3, "empty output, mode/kill-switch gates, and catch-all keep the heuristic standing");
assert.ok(vetBody.includes('normalizePointMode(point?.mode, "rules") !== "api"'), "rules mode never calls out");
assert.ok(vetBody.includes("isDecisionApiDisabled(process.env)"), "the kill switch covers the veto");
assert.ok(vetBody.includes("autoContinueQuestions()"), "the veto asks the single progress Noul");
assert.ok(vetBody.includes("resolveAutoContinue({"), "the veto resolves through the lib cascade");
const seamVetoAt = server.indexOf("const vetoed = decision.proceed");
assert.ok(seamVetoAt >= 0, "the resume path consults the veto");
const sendAt = server.indexOf("await resumeWorker", seamVetoAt);
assert.ok(sendAt > seamVetoAt, "the veto runs before any resume is sent");
assert.ok(server.slice(seamVetoAt, sendAt).includes("!vetoed"), "a veto falls through to the paused path");
assert.match(server, /shouldAutoContinue\(\{/, "the heuristic gate still owns the resume decision");
assert.match(server, /shouldDoneNudge\(\{/, "the audit done-nudge path is untouched");
assert.ok(!vetBody.includes("updateCard("), "the veto writes nothing itself — the paused path below owns all writes");
assert.match(server, /Auto-continue vetoed the resume: the last output showed no real progress\./, "vetoed pauses name the veto in the event trail");

// Per-point routing: every api-mode judgment resolves its route through one
// helper (stored override wins field by field, shared settings fill the
// rest), so a point can pin a model without redeclaring endpoint and key.
// Hot paths log and ignore preset mode instead of spawning judge threads.
assert.ok(decisionSeams.includes("const routeConfig = (point"), "api judgments resolve the point route in one module seam");
assert.ok(vetBody.includes("ignores preset mode"), "the veto names why preset mode never burns a turn");
assert.ok(decisionSeams.includes("inbox severity ignores preset mode"), "severity names why preset mode never burns a turn");
assert.ok(server.includes("async function judgeViaPreset({"), "one runner spawns every preset judgment");
const judgeAt = server.indexOf("async function judgeViaPreset({");
assert.ok(judgeAt >= 0, "the judge runner exists");
const judgeEnd = server.indexOf("\n  }\n", judgeAt);
assert.ok(judgeEnd > judgeAt, "the judge runner body is bounded");
const judgeBody = server.slice(judgeAt, judgeEnd);
assert.ok(judgeBody.includes("visibility: \"hidden\""), "judge threads never surface in the sidebar");
assert.ok(judgeBody.includes("threads.stop({ threadId })"), "timeouts stop the runaway before cleanup");
assert.ok(judgeBody.includes("threads.archive({ threadId })"), "every judgment thread is archived after reading");
assert.ok(judgeBody.includes("PRESET_JUDGE_TIMEOUT_MS"), "the wait is bounded by the lib timeout, not an inline magic number");

// Severity bump wiring: bounded, gated, promotion-only, idempotent. A
// sweep that demotes, resolves, re-judges checked items, or spends
// unboundedly fails here.
const bumpAt = decisionSeams.indexOf("async function maybeBumpSeverity(): Promise<void> {");
assert.ok(bumpAt >= 0, "the bump seam exists in the decision API module");
const bumpEnd = decisionSeams.indexOf("\n  }\n", bumpAt);
assert.ok(bumpEnd > bumpAt, "the bump seam body is bounded");
const bumpBody = decisionSeams.slice(bumpAt, bumpEnd);
assert.ok(decisionSeams.includes("LIMIT 3"), "at most three judgments per tick");
assert.ok(decisionSeams.includes("JOIN cards ON cards.id = inbox_events.card_id"), "bump states carry card context, not bare summaries");
assert.ok(decisionSeams.includes("5 * 60 * 1000"), "fresh items settle before any judgment");
assert.ok(decisionSeams.includes("NOT LIKE '%model-judged%'"), "checked items never re-judge");
assert.ok(bumpBody.includes('normalizePointMode(point?.mode, "rules") !== "api"'), "rules mode never calls out");
assert.ok(bumpBody.includes("isDecisionApiDisabled(process.env)"), "the kill switch covers the bump");
assert.ok(decisionSeams.includes("severityBumpQuestions()"), "the bump asks the single blocking Noul");
assert.ok(decisionSeams.includes("SET severity = 2"), "promotion only ever escalates");
assert.ok(!decisionSeams.includes("resolved_at ="), "the bump never resolves anything");
assert.ok(bumpBody.includes('inbox-changed", { bumped:'), "promotion publishes for reload");
assert.match(server, /void deps\.maybeBumpSeverity\(\);/, "the reconcile tick runs the bump");
assert.match(decisionApiUi, /Showing defaults — nothing saved yet/, "fresh installs state that defaults are in effect");
assert.match(decisionApiUi, /Could not load the Decision API settings\./, "a failed settings load stays answerable");
assert.match(decisionApiUi, /Decision API is disabled on this host/, "the settings block states the kill switch in place");
assert.match(decisionRoutersUi, /has no key — api routers answer with built-in rules/, "keyless api routers state why they degrade");
assert.match(decisionRouterUi, /disabled={busy \|\| !dirty \|\| !valid}/, "threshold saves stay disabled until the value is a 0–1 number");

// UI: two progressive disclosures in the preset manager — one settings
// block, one router list. Modes read as outcomes, never mechanisms.
assert.match(managerShell, /title="Decision API"[\s\S]*?Jev-compatible/, "the settings block hides behind a disclosure");
assert.match(decisionApiUi, /Set the provider first — the rest follows its schema/, "the intro stays one short line");
assert.doesNotMatch(app, /any provider speaking that schema works here/, "the wrapping paragraph stays removed");
assert.match(managerShell, /title="Decision routers"[\s\S]*?per-judgment modes/, "the routers hide behind a disclosure");
assert.match(managerShell, /from "\.\/decision-api"/, "settings consume the extracted decision boundary");
assert.match(decisionEntry, /export \{ DecisionApiSection \} from "\.\/decision-api-section"/, "the settings section keeps one stable entry");
assert.match(decisionEntry, /export \{ DecisionRoutersSection \} from "\.\/decision-routers-section"/, "the routers section keeps one stable entry");
assert.match(decisionApiUi, /export function DecisionApiSection\(/, "the settings section owns the API controls");
assert.match(decisionRoutersUi, /export function DecisionRoutersSection\(/, "the routers section owns the point list");
assert.match(decisionApiUi, /type="password"/, "the key field masks input");
assert.match(decisionApiUi, /Test connection/, "the section offers an explicit probe");
assert.match(decisionRouterUi, /Built-in rules: \{props\.point\.rules\}/, "rules-mode rows explain what built-in means for that point");
assert.match(decisionRouterUi, /Needs: \{props\.point\.requires\}/, "provider requirements render per row");
assert.match(decisionRouterUi, /draft\.mode === "api" \|\| draft\.mode === "preset"/, "threshold controls render only for api and preset drafts");
assert.match(decisionRouterUi, /Act at confidence/, "thresholds read as confidence floors");
assert.match(decisionApiUi, /<span>Model<\/span>\s*<Input/, "the Decision API model field is a free-text input (external ids live outside BB's catalog)");
assert.match(
  decisionApiUi,
  /DECISION_PROVIDERS\.filter\(\(entry\) => entry\.id !== "jev"\)\.map\(\(entry\) => \(/,
  "non-default providers render from the registry (adding one is UI-free)",
);
assert.match(decisionApiUi, /<option value="jev">TypeSafe AI(&apos;|')s Jev-compatible<\/option>/, "the provider select keeps jev (no one-way door)");
assert.match(decisionApiUi, /State \+ questions schema — endpoint \+ key \+ model required/, "the jev hint states the schema requirement in one line");
assert.match(decisionApiUi, /knownDefaults\.includes\(endpoint\)/, "custom endpoint URLs survive provider flips (only pristine defaults swap)");
assert.ok(
  decisionSeams.includes("endpoint: route.endpoint ?? defaultEndpointFor(provider)"),
  "the seam sends the point route endpoint, defaulting only when blank",
);
assert.doesNotMatch(decisionApiUi + decisionRouterUi + decisionRoutersUi, /preset-thread/i, "no thread jargon survives in the UI");

// Router rows save explicitly and refresh locally: flipping the mode select
// stores nothing by itself (preset mode must explain itself first), and a
// save never pays for a board reload — point state lives nowhere else.
assert.match(decisionRouterUi, /const \[mode, setMode\] = useState\(point\.mode\)/, "mode selection stages locally before saving");
assert.match(decisionRouterUi, /modeDirty && draft\.mode !== "preset"/, "mode flips save through one explicit button");
assert.doesNotMatch(decisionRouterUi, /void setMode\(event\.target\.value\)/, "no immediate save rides the select anymore");
assert.match(decisionRouterUi, /role=\{saves\.notice\.isError \? "alert" : "status"\}/, "failures announce as alerts, confirmations stay status");
assert.match(decisionRouterUi, /refresh: \(\) => Promise<void>/, "rows refresh their own section after saving");

// Touch targets meet the repo's min-h-11 rule inside router rows: the mode
// select, the threshold input, and the judge-preset select all render h-11.
// A regression to h-9 fails here before a phone user finds it.
assert.ok(decisionRouterUi.includes('className="cursor-pointer h-11 shrink-0'), "the mode select meets min-h-11");
assert.ok(decisionRouterUi.includes('step="0.05"\n          className="h-11"'), "the threshold input meets min-h-11");
assert.ok(decisionRouterUi.includes('className="cursor-pointer h-11 flex-1'), "the judge-preset select meets min-h-11");

// The decision_points rebuild is one transaction: a crash between DROP and
// RENAME must never lose the rows. Removing the wrapper fails here.
assert.match(decisionServer, /const rebuild = db\.transaction\(\(\) => \{/, "the table rebuild is atomic");
assert.match(
  decisionRoutersUi,
  /const refresh = useCallback\(async \(\) => \{ reload\(\); \}, \[reload\]\)/,
  "the section takes no board reload — router saves stay local",
);
assert.match(decisionRouterUi, /note\("Saved\.", false\)/, "successful saves confirm instead of going silent");
assert.match(
  decisionRouterUi,
  /mode: draft\.mode,\s*thresholds: \{ routeAt: Number\(draft\.routeAt\) \}/,
  "threshold saves carry a pending mode flip so refresh never wipes it",
);
assert.match(decisionRouterUi, /No presets yet — create one under Agent Presets/, "an empty preset catalog guides instead of stranding");

// Criteria command wiring: read-only advisory judging through the router.
// A branch that writes card state or publishes realtime would fail here.
assert.match(
  cliRegistry,
  /"criteria",[\s\S]*?Score an artifact against its skill's semantic criteria/,
  "the command is listed in the extracted CLI registry",
);
const criteriaAt = server.indexOf('if (argv[0] === "criteria") {');
assert.ok(criteriaAt >= 0, "the criteria branch exists");
const criteriaEnd = server.indexOf('if (argv[0] === "draft") {', criteriaAt);
assert.ok(criteriaEnd > criteriaAt, "the criteria branch is bounded");
const criteriaBody = server.slice(criteriaAt, criteriaEnd);
assert.ok(criteriaBody.includes("judgeArtifactCriteria({"), "the branch judges through the lib cascade");
assert.ok(criteriaBody.includes("resolveArtifactPath(PLUGIN_SKILLS_DIR, skillRel)"), "skill reads stay inside the vendored skills dir");
assert.ok(criteriaBody.includes("resolveArtifactPath(workspace.path, artifactArg)"), "artifact reads stay inside the card workspace");
assert.ok(criteriaBody.includes("Set it to Decision API or preset judging in Manage agent presets"), "rules-mode refuses with the UI path named");
assert.ok(criteriaBody.includes("advisory only, never blocking"), "reports state their advisory nature");
assert.ok(!/db\.prepare\("(INSERT|UPDATE|DELETE|REPLACE)/.test(criteriaBody), "the branch makes zero database writes (reads only)");

assert.ok(!criteriaBody.includes("realtime.publish"), "the branch publishes no realtime events");
assert.ok(!criteriaBody.includes("logCardComment"), "the branch leaves no card comments");

// Task evidence: completed statuses are worker assertions — the branch
// asks a judge per completed task whether the working diff shows evidence,
// through the artifact-criteria point. Advisory only: findings guide the
// worker, done decides separately. Same read-only contract as criteria.
assert.match(
  cliRegistry,
  /"verify-tasks",[\s\S]*?Judge completed tasks against the working diff/,
  "the command is listed in the extracted CLI registry",
);
const taskAt = server.indexOf('if (argv[0] === "verify-tasks") {');
assert.ok(taskAt >= 0, "the verify-tasks branch exists");
const taskEnd = server.indexOf('if (argv[0] === "draft") {', taskAt);
assert.ok(taskEnd > taskAt, "the verify-tasks branch is bounded");
const taskBody = server.slice(taskAt, taskEnd);
assert.ok(taskBody.includes("judgeScoredBatch({"), "verdicts resolve through the shared Score-batch judge");
assert.match(
  taskBody,
  /resolveScopeVerdicts\(\{[\s\S]*?scopes: taskScopes,[\s\S]*?taskFindings,[\s\S]*?\}\)/,
  "scopes roll up deterministically from task verdicts",
);
// Tasks with their own verify command run deterministically first (exit 0
// reads met), and when every task verifies, no judge is consulted at all —
// no preset or key required for a fully-declared board.
assert.ok(taskBody.includes("taskVerifyCommand(task)"), "verify commands resolve per task");
assert.ok(taskBody.includes("doneTasks.filter((task) => task.verify !== null)"), "declared tasks partition to the deterministic path");
assert.ok(taskBody.includes("if (judgedTasks.length === 0) {"), "fully-declared boards skip the judge entirely");
assert.ok(taskBody.includes("advisory only, never blocking"), "the report states its advisory nature");
assert.ok(!/db\.prepare\("(INSERT|UPDATE|DELETE|REPLACE)/.test(taskBody), "verify-tasks makes zero database writes");
assert.ok(!taskBody.includes("realtime.publish"), "verify-tasks publishes nothing");
assert.ok(!taskBody.includes("logCardComment"), "verify-tasks leaves no comments");

// The shared Score-batch judge owns both judge paths once (Jev api and
// preset), so verify-tasks and gap-triage cannot drift apart.
const batchAt = server.indexOf("async function judgeScoredBatch(");
assert.ok(batchAt >= 0, "the shared Score-batch judge exists");
const batchBody = server.slice(batchAt, server.indexOf("\n  }\n", batchAt));
assert.ok(batchBody.includes("judgeViaPreset({"), "preset mode judges through the shared judge runner");
assert.ok(batchBody.includes("evaluateDecisionCall({"), "api mode judges through the shared decision call");
assert.ok(batchBody.includes("resolveScoredVerdicts({"), "both paths resolve through the shared resolver");
assert.ok(!/db\.prepare\("(INSERT|UPDATE|DELETE|REPLACE)/.test(batchBody), "the shared judge writes nothing");

// One working-diff extractor for both advisory judges: verify-tasks and
// gap-triage cannot drift into two different notions of "the evidence".
assert.equal(server.match(/"git",\s*\n\s*\["diff", "HEAD"/g)?.length, 1, "exactly one working-diff extractor exists");
assert.ok(server.slice(server.indexOf("const workingDiffFor")).includes("workingDiffFor"), "the extractor is shared, not inlined per command");
assert.match(
  server,
  /const taskDiff = await workingDiffFor\(\s*taskWorkspace\.path,\s*TASK_EVIDENCE_DIFF_CHARS,?\s*\)/,
  "verify-tasks reads its evidence through the shared helper",
);

// Gap triage: escalated gaps are the worker's classification; the judge
// second-opinions genuineness only, never the deterministic routing.
assert.match(
  cliRegistry,
  /"gap-triage",[\s\S]*?Second-opinion escalated critique gaps/,
  "the gap-triage command is listed in the extracted CLI registry",
);
const gapAt = server.indexOf('if (argv[0] === "gap-triage") {');
assert.ok(gapAt >= 0, "the gap-triage branch exists");
const gapBody = server.slice(gapAt, server.indexOf('if (argv[0] === "draft") {', gapAt));
assert.ok(gapBody.includes("critiqueGapState(gapCard)"), "escalated gaps come from the shared registry reader");
assert.ok(gapBody.includes("gapsToTriageBatch(gapState.escalated)"), "the batch maps ids and questions once");
assert.ok(gapBody.includes("judgeScoredBatch({"), "gap triage reuses the shared Score-batch judge");
assert.match(
  gapBody,
  /const gapEvidence = buildGapTriageState\(\{[\s\S]*?critiqueText: gapState\.critiqueText,[\s\S]*?diff: gapDiff,[\s\S]*?\}\)/,
  "the judge state is exactly the critique plus the diff",
);
assert.ok(gapBody.includes("state: gapEvidence,"), "the evidence reaches the judge, not a bare list of gap wordings");
assert.match(
  gapBody,
  /workingDiffFor\(\s*gapWorkspace\.path/,
  "genuineness is judged against the working diff",
);
assert.ok(gapBody.includes("no working-tree diff"), "a missing diff is named, never silently ignored");
assert.ok(gapBody.includes("routing stays deterministic"), "the report states routing is untouched");
assert.ok(!/db\.prepare\("(INSERT|UPDATE|DELETE|REPLACE)/.test(gapBody), "gap-triage makes zero database writes");
assert.ok(!gapBody.includes("realtime.publish"), "gap-triage publishes nothing");
assert.ok(!gapBody.includes("logCardComment"), "gap-triage leaves no comments");

console.log("decision routers test ok: settings discipline, refusals, seam fail-soft, UI disclosure");
