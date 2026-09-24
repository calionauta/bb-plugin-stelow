import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Decision routers wiring: one settings block (endpoint + key + model),
// per-point modes, and a single execution seam at card creation. The test
// that would catch a regression that leaks the key, bypasses the mode gate,
// or acts on unconfigured points.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");
const app = readFileSync(join(root, "app.tsx"), "utf8");

function handlerBody(name) {
  const at = server.indexOf(name);
  assert.ok(at >= 0, `${name} exists`);
  const end = server.indexOf("\n    },\n", at);
  assert.ok(end > at, `${name} body is bounded`);
  return server.slice(at, end);
}

// Singleton config table + per-point table with a closed mode set. Absent
// rows mean unconfigured — new registry points need no migration.
assert.match(server, /CREATE TABLE IF NOT EXISTS decision_api_config \(\s*\n\s*id INTEGER PRIMARY KEY CHECK \(id = 1\)/, "the API settings are one singleton row");
assert.match(server, /CREATE TABLE IF NOT EXISTS decision_points \(\s*\n\s*point TEXT PRIMARY KEY,/, "points key by registry id");
assert.match(server, /mode TEXT NOT NULL CHECK \(mode IN \('rules', 'api', 'preset'\)\)/, "stored modes are closed to rules/api/preset");
assert.match(server, /preset_id TEXT,/, "points pin an optional judge preset");
assert.match(server, /INSERT OR IGNORE INTO decision_points_new \(point, mode, thresholds, updated_at\) SELECT/, "older tables rebuild to widen the mode check without losing rows");

// Contract entries exist for every handler (a handler without one fails
// typecheck; the getter/setter pair must stay in lockstep).
for (const name of ["getDecisionApiConfig", "setDecisionApiConfig", "testDecisionApi", "getDecisionPoint", "setDecisionPoint", "listDecisionPoints"]) {
  assert.match(server, new RegExp(`  ${name}: \\{`), `${name} is in the RPC contract`);
}
for (const name of ["getDecisionApiConfig", "listDecisionPoints", "testDecisionApi"]) {
  assert.match(server, new RegExp(`async ${name}\\(\\) \\{`), `${name} handler exists`);
}
for (const name of ["setDecisionApiConfig", "getDecisionPoint", "setDecisionPoint"]) {
  assert.match(server, new RegExp(`async ${name}\\(\\{`), `${name} handler exists`);
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
const setterBody = handlerBody("async setDecisionApiConfig({ endpoint, apiKey, model, provider }) {");
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
assert.match(server, /disabled: z\.boolean\(\)/, "the config contract carries the disabled flag");
assert.ok(configBody.includes("disabled: isDecisionApiDisabled(process.env)"), "reads report the disabled flag");
assert.ok(configBody.includes("configured: row !== undefined"), "reads report whether anything was ever saved (defaults vs configured)");
// Provider adapters: the config row carries a provider with a jev default
// for pre-adapter installs; unknown names refuse with the valid set.
assert.match(server, /ADD COLUMN provider TEXT NOT NULL DEFAULT 'jev'/, "pre-adapter installs migrate with the jev default");
assert.match(server, /provider: z\.string\(\)\.max\(20\)\.nullable\(\)\.optional\(\)/, "the setter input carries the provider (strict would drop it otherwise)");
assert.ok(setterBody.includes("Unknown provider"), "unknown providers refuse");
assert.ok(setterBody.includes("DECISION_PROVIDERS.map((entry) => entry.id).join"), "provider refusals name the valid set");

// Point writes refuse unknown ids and modes with the valid set named;
// preset mode additionally refuses hot paths and unknown presets at save
// time, so a misconfigured point never silently degrades at use time.
// Reads degrade to registry defaults instead of refusing.
const pointSetter = handlerBody("async setDecisionPoint({ point, mode, thresholds, route, presetId }) {");
assert.ok(pointSetter.includes("Unknown decision point"), "unknown points refuse");
assert.ok(pointSetter.includes("Available: ${DECISION_POINTS"), "point refusals name the valid set");
assert.ok(pointSetter.includes("Unknown mode"), "unknown modes refuse");
assert.ok(pointSetter.includes("STELOW_DECISION_API=0"), "api-mode writes refuse naming the variable");
assert.ok(pointSetter.includes("cannot judge via preset"), "hot paths refuse preset mode with the cost reason");
assert.ok(pointSetter.includes("Preset mode needs a judge preset"), "preset mode without a preset refuses in user words, never an id");
assert.ok(pointSetter.includes("Unknown preset"), "preset mode with a missing preset refuses");
assert.ok(pointSetter.includes("Absent params preserve the stored row"), "flipping modes keeps route and preset");
const pointGetter = handlerBody("async getDecisionPoint({ point }) {");
assert.ok(pointGetter.includes("normalizePointMode("), "reads normalize unknown modes to rules");
const listBody = handlerBody("async listDecisionPoints() {");
assert.ok(listBody.includes("DECISION_POINTS.map("), "the list derives from the registry — never a pasted copy");
assert.ok(listBody.includes("rules: def.rules"), "the list exposes what built-in rules do per point");
assert.ok(listBody.includes("requires: def.requires ?? null"), "the list exposes provider requirements");

// Execution seam: build creations consult the router exactly once, and the
// router fails soft to "unknown" on every path (mode gate, missing key,
// catch-all) so creation never breaks for a misconfigured point.
assert.match(server, /explicitIntent !== "unknown" \? explicitIntent : await seedBuildIntentFromRouter\(prompt, workspaceProjectId\)/, "explicit caller intent wins; otherwise the router seeds with the card project, else triage settles");
const seamAt = server.indexOf("async function seedBuildIntentFromRouter(promptText: string, projectId: string | null): Promise<string> {");
assert.ok(seamAt >= 0, "the router helper exists");
const seamEnd = server.indexOf("\n  }\n", seamAt);
assert.ok(seamEnd > seamAt, "the router helper body is bounded");
const seamBody = server.slice(seamAt, seamEnd);
assert.ok((seamBody.match(/return "unknown"/g) ?? []).length >= 3, "mode gate, missing key, and catch-all all degrade to unknown");
assert.ok(seamBody.includes("resolveSeedIntent({"), "seeding resolves through the lib cascade");
assert.ok(seamBody.includes('normalizePointMode(point?.mode, "rules")'), "unconfigured points default to rules — a fallback flip to api fails here");
assert.ok(seamBody.includes("triage intent seeded from Decision API"), "api seeds leave a log trail with the outcome");
assert.ok(seamBody.includes("triage intent router fell back to built-in rules"), "api failures log the fallback instead of failing silently");
assert.ok(seamBody.includes("isDecisionApiDisabled(process.env)"), "the seam consults the kill switch first");
assert.ok(seamBody.includes("provider,"), "the seam forwards the configured provider");
assert.ok(probeBody.includes("buildProbeCall(provider)"), "the probe speaks the provider's native shape");

// Auto-continue veto wiring: the heuristic still owns the resume decision;
// the router only vetoes confident chatter. Guards that disappear here
// would silently spend worker turns — each is pinned.
const pointsLib = readFileSync(join(root, "lib", "decision-points.mjs"), "utf8");
assert.match(pointsLib, /id: DECISION_POINT_AUTO_CONTINUE,/, "the auto-continue point is registered");
assert.ok(pointsLib.includes('defaultThresholds: { routeAt: 0.7 }'), "the veto floor prices worker turns above the free triage seed");
const vetAt = server.indexOf("async function vetAutoContinueNudge(stateText: string | null): Promise<boolean> {");
assert.ok(vetAt >= 0, "the veto helper exists");
assert.ok(server.includes(".get(DECISION_POINT_AUTO_CONTINUE)"), "the veto reads its own point row");
const vetEnd = server.indexOf("\n  }\n", vetAt);
assert.ok(vetEnd > vetAt, "the veto helper body is bounded");
const vetBody = server.slice(vetAt, vetEnd);
assert.ok((vetBody.match(/return true;/g) ?? []).length >= 5, "every fallback path keeps the heuristic standing (empty output, rules mode, disabled, missing key, call failure, catch-all)");
assert.ok(vetBody.includes('normalizePointMode(point?.mode, "rules") !== "api"'), "rules mode never calls out");
assert.ok(vetBody.includes("isDecisionApiDisabled(process.env)"), "the kill switch covers the veto");
assert.ok(vetBody.includes("autoContinueQuestions()"), "the veto asks the single progress Noul");
assert.ok(vetBody.includes("resolveAutoContinue({"), "the veto resolves through the lib cascade");
const seamVetoAt = server.indexOf("const vetted = await vetAutoContinueNudge(");
assert.ok(seamVetoAt >= 0, "the resume path consults the veto");
const sendAt = server.indexOf("buildContinueNudge()", seamVetoAt);
assert.ok(sendAt > seamVetoAt, "the veto runs before any resume is sent");
assert.ok(server.slice(seamVetoAt, sendAt).includes("if (!vetted)"), "a veto falls through to the paused path");
assert.match(server, /const autoDecision = shouldAutoContinue\(\{/, "the heuristic gate still owns the resume decision");
assert.match(server, /const doneDecision = shouldDoneNudge\(\{/, "the audit done-nudge path is untouched");
assert.ok(!vetBody.includes("updateCard("), "the veto writes nothing itself — the paused path below owns all writes");
assert.match(server, /Auto-continue vetoed the resume: the last output showed no real progress\./, "vetoed pauses name the veto in the event trail");

// Per-point routing: every api-mode judgment resolves its route through one
// helper (stored override wins field by field, shared settings fill the
// rest), so a point can pin a model without redeclaring endpoint and key.
// Hot paths log and ignore preset mode instead of spawning judge threads.
assert.ok(server.includes("pointRouteConfig(point, cfg)"), "api judgments resolve the point route in one place");
assert.ok(vetBody.includes("ignores preset mode"), "the veto names why preset mode never burns a turn");
assert.ok(server.includes("ignores preset mode"), "severity names why preset mode never burns a turn");
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
const bumpAt = server.indexOf("async function maybeBumpSeverity(): Promise<void> {");
assert.ok(bumpAt >= 0, "the bump helper exists");
const bumpEnd = server.indexOf("\n  }\n", bumpAt);
assert.ok(bumpEnd > bumpAt, "the bump helper body is bounded");
const bumpBody = server.slice(bumpAt, bumpEnd);
assert.ok(bumpBody.includes("LIMIT 3"), "at most three judgments per tick");
assert.ok(bumpBody.includes("JOIN cards ON cards.id = inbox_events.card_id"), "bump states carry card context, not bare summaries");
assert.ok(bumpBody.includes("SEVERITY_BUMP_MIN_AGE_MS"), "fresh items settle before any judgment");
assert.ok(bumpBody.includes("NOT LIKE '%model-judged%'"), "checked items never re-judge");
assert.ok(bumpBody.includes('normalizePointMode(point?.mode, "rules") !== "api"'), "rules mode never calls out");
assert.ok(bumpBody.includes("isDecisionApiDisabled(process.env)"), "the kill switch covers the bump");
assert.ok(bumpBody.includes("severityBumpQuestions()"), "the bump asks the single blocking Noul");
assert.ok(bumpBody.includes("SET severity = 2"), "promotion only ever escalates");
assert.ok(!bumpBody.includes("resolved_at ="), "the bump never resolves anything");
assert.ok(bumpBody.includes('inbox-changed", { bumped:'), "promotion publishes for reload");
assert.match(server, /void maybeBumpSeverity\(\);/, "the reconcile tick runs the bump");
assert.match(app, /Showing defaults — nothing saved yet/, "fresh installs state that defaults are in effect");
assert.match(app, /Decision API is disabled on this host/, "the settings block states the kill switch in place");
assert.match(app, /has no key — api routers answer with built-in rules/, "keyless api routers state why they degrade");
assert.match(app, /disabled={busy \|\| !dirty \|\| !valid}/, "threshold saves stay disabled until the value is a 0–1 number");

// UI: two progressive disclosures in the preset manager — one settings
// block, one router list. Modes read as outcomes, never mechanisms.
assert.match(app, /<DisclosureSection title="Decision API" hint="Jev-compatible"/, "the settings block hides behind a disclosure");
assert.match(app, /Set the provider first — the rest follows its schema/, "the intro stays one short line");
assert.doesNotMatch(app, /any provider speaking that schema works here/, "the wrapping paragraph stays removed");
assert.match(app, /<DisclosureSection title="Decision routers" hint="per-judgment modes"/, "the routers hide behind a disclosure");
assert.match(app, /function DecisionApiSection\(/, "the settings section exists");
assert.match(app, /function DecisionRoutersSection\(/, "the routers section exists");
assert.match(app, /type="password"/, "the key field masks input");
assert.match(app, /Test connection/, "the section offers an explicit probe");
assert.match(app, /Built-in rules: \{point\.rules\}/, "rules-mode rows explain what built-in means for that point");
assert.match(app, /Needs: \{point\.requires\}/, "provider requirements render per row");
assert.match(app, /point\.mode === "api"/, "threshold controls render only for api-mode points");
assert.match(app, /Act at confidence/, "thresholds read as confidence floors");
assert.match(app, /<span>Model<\/span><Input/, "the Decision API model field is a free-text input (external ids live outside BB's catalog)");
assert.match(app, /\{DECISION_PROVIDERS\.filter\(\(entry\) => entry\.id !== "jev"\)\.map\(\(entry\) => <option/, "non-default providers render from the registry (adding one is UI-free)");
assert.match(app, /<option value="jev">TypeSafe AI(&apos;|')s Jev-compatible<\/option>/, "the provider select keeps jev (no one-way door)");
assert.match(app, /State \+ questions schema — endpoint \+ key \+ model required/, "the jev hint states the schema requirement in one line");
assert.match(app, /knownDefaults\.includes\(endpoint\)/, "custom endpoint URLs survive provider flips (only pristine defaults swap)");
assert.ok(seamBody.includes("endpoint: route.endpoint ?? defaultEndpointFor(provider)"), "the seam sends the point route endpoint, defaulting only when blank");
assert.doesNotMatch(app, /preset-thread/i, "no thread jargon survives in the UI");

// Router rows save explicitly and refresh locally: flipping the mode select
// stores nothing by itself (preset mode must explain itself first), and a
// save never pays for a board reload — point state lives nowhere else.
assert.match(app, /const \[modeDraft, setModeDraft\] = useState\(point\.mode\)/, "mode selection stages locally before saving");
assert.match(app, /\{modeDirty && modeDraft !== "preset" \? <Button/, "mode flips save through one explicit button");
assert.doesNotMatch(app, /void setMode\(event\.target\.value\)/, "no immediate save rides the select anymore");
assert.match(app, /role=\{isError \? "alert" : "status"\}/, "failures announce as alerts, confirmations stay status");
assert.match(app, /refresh: \(\) => Promise<void>/, "rows refresh their own section after saving");

// Touch targets meet the repo's min-h-11 rule inside router rows: the mode
// select, the threshold input, and the judge-preset select all render h-11.
// A regression to h-9 fails here before a phone user finds it.
assert.ok(app.includes('className="cursor-pointer h-11 shrink-0'), "the mode select meets min-h-11");
assert.ok(app.includes('step="0.05" className="h-11"'), "the threshold input meets min-h-11");
assert.ok(app.includes('judge preset`} className="cursor-pointer h-11 flex-1'), "the judge-preset select meets min-h-11");

// The decision_points rebuild is one transaction: a crash between DROP and
// RENAME must never lose the rows. Removing the wrapper fails here.
assert.match(server, /const rebuildDecisionPoints = db\.transaction\(\(\) => \{/, "the table rebuild is atomic");
assert.match(app, /function DecisionRoutersSection\(\{ rpc \}/, "the section takes no board reload — router saves stay local");
assert.match(app, /note\("Saved\.", false\)/, "successful saves confirm instead of going silent");
assert.match(app, /mode: modeDraft, thresholds: \{ routeAt: Number\(routeAt\) \}/, "threshold saves carry a pending mode flip so refresh never wipes it");
assert.match(app, /No presets yet — create one under Agent Presets/, "an empty preset catalog guides instead of stranding");

// Criteria command wiring: read-only advisory judging through the router.
// A branch that writes card state or publishes realtime would fail here.
assert.match(server, /name: "criteria", summary: "Score an artifact against its skill's semantic criteria/, "the command is listed");
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
assert.match(server, /name: "verify-tasks", summary: "Judge completed tasks against the working diff/, "the command is listed");
const taskAt = server.indexOf('if (argv[0] === "verify-tasks") {');
assert.ok(taskAt >= 0, "the verify-tasks branch exists");
const taskEnd = server.indexOf('if (argv[0] === "draft") {', taskAt);
assert.ok(taskEnd > taskAt, "the verify-tasks branch is bounded");
const taskBody = server.slice(taskAt, taskEnd);
assert.ok(taskBody.includes("judgeScoredBatch({"), "verdicts resolve through the shared Score-batch judge");
assert.ok(taskBody.includes("resolveScopeVerdicts({ scopes: taskScopes, taskFindings })"), "scopes roll up deterministically from task verdicts");
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
assert.equal(server.match(/git", \["diff", "HEAD"/g)?.length, 1, "exactly one working-diff extractor exists");
assert.ok(server.slice(server.indexOf("const workingDiffFor")).includes("workingDiffFor"), "the extractor is shared, not inlined per command");
assert.match(server, /const taskDiff = await workingDiffFor\(taskWorkspace\.path, TASK_EVIDENCE_DIFF_CHARS\)/, "verify-tasks reads its evidence through the shared helper");

// Gap triage: escalated gaps are the worker's classification; the judge
// second-opinions genuineness only, never the deterministic routing.
assert.match(server, /name: "gap-triage", summary: "Second-opinion escalated critique gaps/, "the gap-triage command is listed");
const gapAt = server.indexOf('if (argv[0] === "gap-triage") {');
assert.ok(gapAt >= 0, "the gap-triage branch exists");
const gapBody = server.slice(gapAt, server.indexOf('if (argv[0] === "draft") {', gapAt));
assert.ok(gapBody.includes("critiqueGapState(gapCard)"), "escalated gaps come from the shared registry reader");
assert.ok(gapBody.includes("gapsToTriageBatch(gapState.escalated)"), "the batch maps ids and questions once");
assert.ok(gapBody.includes("judgeScoredBatch({"), "gap triage reuses the shared Score-batch judge");
assert.ok(/const gapEvidence = buildGapTriageState\(\{ critiqueText: gapState\.critiqueText, diff: gapDiff \}\)/.test(gapBody), "the judge state is exactly the critique plus the diff");
assert.ok(gapBody.includes("state: gapEvidence,"), "the evidence reaches the judge, not a bare list of gap wordings");
assert.ok(gapBody.includes("workingDiffFor(gapWorkspace.path"), "genuineness is judged against the working diff");
assert.ok(gapBody.includes("no working-tree diff"), "a missing diff is named, never silently ignored");
assert.ok(gapBody.includes("routing stays deterministic"), "the report states routing is untouched");
assert.ok(!/db\.prepare\("(INSERT|UPDATE|DELETE|REPLACE)/.test(gapBody), "gap-triage makes zero database writes");
assert.ok(!gapBody.includes("realtime.publish"), "gap-triage publishes nothing");
assert.ok(!gapBody.includes("logCardComment"), "gap-triage leaves no comments");

console.log("decision routers test ok: settings discipline, refusals, seam fail-soft, UI disclosure");
