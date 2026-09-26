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
  readFileSync(join(root, "server/runtime/runtime-services.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/git-evidence.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/build-thread-sync.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/reconciler.ts"), "utf8"),
  readFileSync(join(root, "server/cards-create.ts"), "utf8"),
].join("\n");
const decisionServer = [
  "decision-api.ts",
  "decision-store.ts",
  "decision-config-rpcs.ts",
  "decision-point-rpcs.ts",
  "decision-point-rules.ts",
  "decision-review-policy.ts",
]
  .map((file) => readFileSync(join(root, "server", file), "utf8"))
  .join("\n");
const decisionStore = readFileSync(join(root, "server", "decision-store.ts"), "utf8");
const decisionConfig = readFileSync(join(root, "server", "decision-config-rpcs.ts"), "utf8");
const decisionPointRpcs = readFileSync(join(root, "server", "decision-point-rpcs.ts"), "utf8");
const decisionRules = readFileSync(join(root, "server", "decision-point-rules.ts"), "utf8");
const decisionRoute = readFileSync(join(root, "server", "decision-route.ts"), "utf8");
const decisionSeed = readFileSync(join(root, "server", "decision-seed.ts"), "utf8");
const decisionVeto = readFileSync(join(root, "server", "decision-auto-continue.ts"), "utf8");
const decisionSeverity = readFileSync(join(root, "server", "decision-severity.ts"), "utf8");
const decisionContract = readFileSync(join(root, "server", "decision-api-contract.ts"), "utf8");
const presetJudgeRunner = readFileSync(join(root, "server", "decisions", "preset-judge-runner.ts"), "utf8");
const scoredBatchJudge = readFileSync(join(root, "server", "decisions", "scored-batch-judge.ts"), "utf8");
const cliRegistry = readFileSync(join(root, "server/runtime/cli-registry.ts"), "utf8");

function handlerBody(name) {
  const at = decisionServer.indexOf(name);
  assert.ok(at >= 0, `${name} exists in the decision API module`);
  const end = decisionServer.indexOf("\n    },\n", at);
  assert.ok(end > at, `${name} body is bounded`);
  return decisionServer.slice(at, end);
}

/** One module-level function body, so a pin scopes to its own slice. */
function sliceFunction(source, signature) {
  const at = source.indexOf(signature);
  assert.ok(at >= 0, `${signature} exists`);
  const end = source.indexOf("\n}\n", at);
  assert.ok(end > at, `${signature} body is bounded`);
  return source.slice(at, end);
}

// Singleton config table + per-point table with a closed mode set. Absent
// rows mean unconfigured — new registry points need no migration. The
// decision store owns both, so every other slice reads through it.
assert.match(
  decisionStore,
  /CREATE TABLE IF NOT EXISTS decision_api_config \(\s*\n\s*id INTEGER PRIMARY KEY CHECK \(id = 1\)/,
  "the API settings are one singleton row",
);
assert.match(decisionStore, /CREATE TABLE IF NOT EXISTS decision_points \(\s*\n\s*point TEXT PRIMARY KEY,/, "points key by registry id");
assert.match(decisionStore, /mode TEXT NOT NULL CHECK \(mode IN \('rules', 'api', 'preset'\)\)/, "stored modes are closed to rules/api/preset");
assert.match(decisionStore, /preset_id TEXT,/, "points pin an optional judge preset");
assert.match(
  decisionStore,
  /INSERT OR IGNORE INTO decision_points_new \(point, mode, thresholds, updated_at\) SELECT/,
  "older tables rebuild to widen the mode check without losing rows",
);
assert.match(
  decisionStore,
  /const rebuild = db\.transaction\(\(\) => \{/,
  "the table rebuild is atomic — a crash between DROP and RENAME loses no rows",
);

// Contract entries exist for every handler (a handler without one fails
// typecheck; the getter/setter pair must stay in lockstep).
for (const name of ["getDecisionApiConfig", "setDecisionApiConfig", "testDecisionApi", "getDecisionPoint", "setDecisionPoint", "listDecisionPoints"]) {
  assert.match(decisionContract, new RegExp(`  ${name}: \\{`), `${name} is in the module RPC contract`);
}
for (const name of ["getDecisionApiConfig", "listDecisionPoints", "testDecisionApi"]) {
  assert.match(decisionServer, new RegExp(`async ${name}\\(\\) \\{`), `${name} handler exists`);
}
for (const [name, signature] of [
  ["setDecisionApiConfig", "async setDecisionApiConfig\\(input: ConfigInput\\)"],
  ["getDecisionPoint", "async getDecisionPoint\\(\\{ point \\}: \\{ point: string \\}\\)"],
  ["setDecisionPoint", "async setDecisionPoint\\(input: PointWriteInput\\)"],
]) {
  assert.match(decisionServer, new RegExp(signature), `${name} handler exists`);
}

// The key never leaves the host: reads report presence + source only.
const configBody = sliceFunction(decisionConfig, "function getDecisionApiConfig(");
assert.ok(configBody.includes("hasKey: key !== null"), "reads report key presence, not the key");
assert.ok(configBody.includes("keySource"), "reads report where the key came from");
assert.ok(configBody.includes("resolveDecisionApiKey"), "reads resolve through the single key cascade");
// Negative pin: the raw key must never ride the return. The body legitimately
// reads row.api_key as cascade input, so the ban scopes to the returned
// object — adding `api_key:` to it fails here.
assert.ok(!configBody.includes("api_key:"), "the getter return never carries the raw key");

// Setter resolves the whole row first, then writes: a refusal never reaches
// the store. The resolver distinguishes keep (absent) from clear (null) for
// the key and names the fix for a bad endpoint.
const setterBody = sliceFunction(decisionConfig, "function setDecisionApiConfig(");
assert.ok(setterBody.includes("resolveConfig(ctx.store, input)"), "the setter resolves before it writes");
assert.ok(setterBody.includes("if (!resolved.ok) return"), "a refused save returns before any write");
assert.ok(setterBody.includes("ctx.store.saveConfig("), "a valid save persists through the store");
const resolverBody = sliceFunction(decisionConfig, "function resolveConfig(");
assert.ok(resolverBody.includes("must be an http(s) URL"), "bad endpoints refuse with the fix named");
assert.ok(resolverBody.includes("input.apiKey === undefined"), "an absent key keeps the stored one");
assert.ok(resolverBody.includes("(input.apiKey ??"), "an explicit null clears the stored one");

// The probe is the only on-demand spend: fixed question, latency reported.
const probeBody = sliceFunction(decisionConfig, "async function testDecisionApi(");
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
assert.match(decisionStore, /ADD COLUMN provider TEXT NOT NULL DEFAULT 'jev'/, "pre-adapter installs migrate with the jev default");
assert.match(
  decisionContract,
  /provider: z\.string\(\)\.max\(20\)\.nullable\(\)\.optional\(\)/,
  "the setter input carries the provider (strict would drop it otherwise)",
);
assert.ok(resolverBody.includes("Unknown provider"), "unknown providers refuse");
assert.ok(resolverBody.includes("DECISION_PROVIDERS.map((entry) => entry.id).join"), "provider refusals name the valid set");

// Point writes refuse unknown ids and modes with the valid set named;
// preset mode additionally refuses hot paths and unknown presets at save
// time, so a misconfigured point never silently degrades at use time.
// Reads degrade to registry defaults instead of refusing. The rules module
// owns the refusals; the RPC only reads the stored row and saves.
const pointSetter = handlerBody("async setDecisionPoint(");
assert.ok(pointSetter.includes("store.pointRow(input.point)"), "flipping modes reads the stored row");
assert.ok(pointSetter.includes("resolvePointWrite(input, existing, ctx)"), "one rules module decides every point write");
assert.ok(pointSetter.includes("if (!resolved.ok) return"), "a refused point write returns before any save");
assert.ok(pointSetter.includes("store.savePoint("), "a valid point write persists through the store");
const rulesAt = decisionRules.indexOf("export function resolvePointWrite(");
const rulesEnd = decisionRules.indexOf("function resolveRoute(", rulesAt);
const pointRules = decisionRules.slice(rulesAt, rulesEnd);
assert.ok(pointRules.includes("Unknown decision point"), "unknown points refuse");
assert.ok(pointRules.includes("Available: ${DECISION_POINTS"), "point refusals name the valid set");
assert.ok(pointRules.includes("Unknown mode"), "unknown modes refuse");
assert.ok(pointRules.includes("STELOW_DECISION_API=0"), "api-mode writes refuse naming the variable");
assert.ok(pointRules.includes("cannot judge via preset"), "hot paths refuse preset mode with the cost reason");
assert.ok(pointRules.includes("Preset mode needs a judge preset"), "preset mode without a preset refuses in user words, never an id");
assert.ok(pointRules.includes("Unknown preset"), "preset mode with a missing preset refuses");
const pointGetter = handlerBody("async getDecisionPoint(");
assert.ok(pointGetter.includes("store.pointView("), "single and list reads share one normalized point view");
assert.ok(decisionStore.includes("normalizePointMode(row?.mode"), "reads normalize unknown modes to rules");
assert.ok(decisionPointRpcs.includes("DECISION_POINTS.map("), "the list derives from the registry — never a pasted copy");
assert.ok(decisionPointRpcs.includes("rules: def.rules"), "the list exposes what built-in rules do per point");
assert.ok(decisionPointRpcs.includes("requires: def.requires ?? null"), "the list exposes provider requirements");

// Execution seam: build creations consult the router exactly once, and the
// router fails soft to "unknown" on every path (mode gate, missing key,
// catch-all) so creation never breaks for a misconfigured point.
assert.match(
  server,
  /explicitIntent !== "unknown" \? explicitIntent\s*:\s*await deps\.seedBuildIntent\(input\.prompt, workspace\.projectId\)/,
  "explicit caller intent wins; otherwise the router seeds with the card project, else triage settles",
);
const seamAt = decisionSeed.indexOf("async function seedBuildIntent(\n");
assert.ok(seamAt >= 0, "the router seam exists in the decision seed slice");
const seamEnd = decisionSeed.indexOf("\n  }\n", seamAt);
assert.ok(seamEnd > seamAt, "the router seam body is bounded");
const seamBody = decisionSeed.slice(seamAt, seamEnd);
assert.ok(seamBody.includes("return \"unknown\""), "disabled triage seeds stay unknown");
assert.ok(seamBody.includes('normalizePointMode(point?.mode, "rules")'), "unconfigured points default to rules — a fallback flip to api fails here");
assert.ok(decisionSeed.includes("resolveSeedIntent({"), "seeding resolves through the lib cascade");
// The seeded/fallback log trail is asserted on real captured log lines in
// decision-seed-runtime.test.mjs, not on a literal surviving in the source:
// both judges now name themselves as an argument, so a string pin would only
// constrain the wording of a log line whose absence no pin here can detect.
assert.ok(decisionSeed.includes("triage intent router fell back to built-in rules"), "api failures log the fallback instead of failing silently");
assert.ok(decisionSeed.includes("isDecisionApiDisabled(process.env)"), "the seam consults the kill switch first");
assert.ok(decisionSeed.includes("provider: call.provider"), "the seam forwards the configured provider");
assert.ok(probeBody.includes("buildProbeCall(provider)"), "the probe speaks the provider's native shape");

// Auto-continue veto wiring: the heuristic still owns the resume decision;
// the router only vetoes confident chatter. Guards that disappear here
// would silently spend worker turns — each is pinned.
const pointsLib = readFileSync(join(root, "lib", "decision-points.mjs"), "utf8");
assert.match(pointsLib, /id: DECISION_POINT_AUTO_CONTINUE,/, "the auto-continue point is registered");
assert.ok(pointsLib.includes('defaultThresholds: { routeAt: 0.7 }'), "the veto floor prices worker turns above the free triage seed");
const vetAt = decisionVeto.indexOf("async function vetAutoContinue(");
assert.ok(vetAt >= 0, "the veto seam exists in the auto-continue slice");
assert.ok(decisionVeto.includes("pointRow(DECISION_POINT_AUTO_CONTINUE)"), "the veto reads its own point row through the feature seam");
const vetEnd = decisionVeto.indexOf("\n  }\n", vetAt);
assert.ok(vetEnd > vetAt, "the veto seam body is bounded");
const vetBody = decisionVeto.slice(vetAt, vetEnd);
assert.ok((vetBody.match(/return true/g) ?? []).length >= 3, "empty output, mode/kill-switch gates, and catch-all keep the heuristic standing");
assert.ok(vetBody.includes('mode !== "api"'), "rules mode never calls out");
assert.ok(vetBody.includes("isDecisionApiDisabled(process.env)"), "the kill switch covers the veto");
assert.ok(decisionVeto.includes("autoContinueQuestions()"), "the veto asks the single progress Noul");
assert.ok(decisionVeto.includes("resolveAutoContinue({"), "the veto resolves through the lib cascade");
const seamVetoAt = server.indexOf("const vetoed = decision.proceed");
assert.ok(seamVetoAt >= 0, "the resume path consults the veto");
const sendAt = server.indexOf("await resumeWorker", seamVetoAt);
assert.ok(sendAt > seamVetoAt, "the veto runs before any resume is sent");
assert.ok(server.slice(seamVetoAt, sendAt).includes("!vetoed"), "a veto falls through to the paused path");
assert.match(server, /shouldAutoContinue\(\{/, "the heuristic gate still owns the resume decision");
assert.match(server, /shouldDoneNudge\(\{/, "the audit done-nudge path is untouched");
assert.ok(!decisionVeto.includes("updateCard("), "the veto writes nothing itself — the paused path below owns all writes");
assert.match(server, /Auto-continue vetoed the resume: the last output showed no real progress\./, "vetoed pauses name the veto in the event trail");

// Per-point routing: every api-mode judgment resolves its route through one
// module (stored override wins field by field, shared settings fill the
// rest), so a point can pin a model without redeclaring endpoint and key.
// Hot paths log and ignore preset mode instead of spawning judge threads.
assert.ok(decisionRoute.includes("export function createDecisionRoute"), "api judgments resolve the point route in one module seam");
assert.ok(decisionRoute.includes("resolveDecisionApiKey({"), "the key cascade resolves once, in the route module");
assert.ok(vetBody.includes("ignores preset mode"), "the veto names why preset mode never burns a turn");
assert.ok(decisionSeverity.includes("inbox severity ignores preset mode"), "severity names why preset mode never burns a turn");
assert.ok(server.includes("createPresetJudgeRunner({ bb, getPresetById })"), "composition installs one preset judge runner");
const judgeAt = presetJudgeRunner.indexOf("function judgeWithPreset(");
assert.ok(judgeAt >= 0, "the judge runner exists in the decision slice");
const judgeEnd = presetJudgeRunner.indexOf("\n}\n", judgeAt);
assert.ok(judgeEnd > judgeAt, "the judge runner body is bounded");
const judgeBody = presetJudgeRunner.slice(judgeAt, judgeEnd);
assert.ok(presetJudgeRunner.includes("visibility: \"hidden\""), "judge threads never surface in the sidebar");
assert.ok(presetJudgeRunner.includes("threads.stop({ threadId })"), "timeouts stop the runaway before cleanup");
assert.ok(presetJudgeRunner.includes("threads.archive({ threadId })"), "every judgment thread is archived after reading");
assert.ok(judgeBody.includes("PRESET_JUDGE_TIMEOUT_MS"), "the wait is bounded by the lib timeout, not an inline magic number");

// Severity bump wiring: bounded, gated, promotion-only, idempotent. A
// sweep that demotes, resolves, re-judges checked items, or spends
// unboundedly fails here.
const bumpBody = sliceFunction(decisionSeverity, "async function maybeBumpSeverity(");
assert.ok(decisionSeverity.includes("LIMIT 3"), "at most three judgments per tick");
assert.ok(decisionSeverity.includes("JOIN cards ON cards.id = inbox_events.card_id"), "bump states carry card context, not bare summaries");
assert.ok(decisionSeverity.includes("5 * 60 * 1000"), "fresh items settle before any judgment");
assert.ok(decisionSeverity.includes("NOT LIKE '%model-judged%'"), "checked items never re-judge");
assert.ok(bumpBody.includes('mode !== "api"'), "rules mode never calls out");
assert.ok(bumpBody.includes("isDecisionApiDisabled(process.env)"), "the kill switch covers the bump");
assert.ok(decisionSeverity.includes("severityBumpQuestions()"), "the bump asks the single blocking Noul");
assert.ok(decisionSeverity.includes("SET severity = 2"), "promotion only ever escalates");
assert.ok(!decisionSeverity.includes("resolved_at ="), "the bump never resolves anything");
assert.ok(bumpBody.includes('inbox-changed", { bumped:'), "promotion publishes for reload");
assert.match(server, /void deps\.maybeBumpSeverity\(\);/, "the reconcile tick runs the bump");
assert.ok(
  decisionRoute.includes("route.endpoint ?? defaultEndpointFor(provider)"),
  "the seam sends the point route endpoint, defaulting only when blank",
);

// Criteria command wiring: read-only advisory judging through the router.
// A branch that writes card state or publishes realtime would fail here.
assert.match(
  cliRegistry,
  /"criteria",[\s\S]*?Score an artifact against its skill's semantic criteria/,
  "the command is listed in the extracted CLI registry",
);
const criteriaBody = readFileSync(join(root, "server/runtime/cli/cli-criteria.ts"), "utf8");
assert.match(criteriaBody, /argv\[0\] !== "criteria"\) return null;/, "the criteria family claims exactly its verb");
assert.ok(criteriaBody.includes("judgeArtifactCriteria({"), "the branch judges through the lib cascade");
assert.ok(criteriaBody.includes("resolveArtifactPath(deps.skillsDir, skillRel)"), "skill reads stay inside the vendored skills dir");
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
const taskBody = readFileSync(join(root, "server/runtime/cli/cli-verify-tasks.ts"), "utf8");
assert.match(taskBody, /argv\[0\] !== "verify-tasks"\) return null;/, "the verify-tasks family claims exactly its verb");
assert.ok(taskBody.includes("judgeScoredBatch({"), "verdicts resolve through the shared Score-batch judge");
assert.match(
  taskBody,
  /resolveScopeVerdicts\(\{ scopes, taskFindings: findings \}\)/,
  "scopes roll up deterministically from task verdicts",
);
// Tasks with their own verify command run deterministically first (exit 0
// reads met), and when every task verifies, no judge is consulted at all —
// no preset or key required for a fully-declared board.
assert.ok(taskBody.includes("taskVerifyCommand(task)"), "verify commands resolve per task");
assert.ok(taskBody.includes("doneTasks.filter((task) => task.verify !== null)"), "declared tasks partition to the deterministic path");
assert.ok(
  taskBody.includes("if (judgedTasks.length === 0) return commandFindings;"),
  "fully-declared boards skip the judge entirely",
);
assert.ok(taskBody.includes("advisory only, never blocking"), "the report states its advisory nature");
assert.ok(!/db\.prepare\("(INSERT|UPDATE|DELETE|REPLACE)/.test(taskBody), "verify-tasks makes zero database writes");
assert.ok(!taskBody.includes("realtime.publish"), "verify-tasks publishes nothing");
assert.ok(!taskBody.includes("logCardComment"), "verify-tasks leaves no comments");

// The shared Score-batch judge owns both judge paths once (Jev api and
// preset), so verify-tasks and gap-triage cannot drift apart.
const batchAt = scoredBatchJudge.indexOf("async function judgeWithPreset(");
assert.ok(batchAt >= 0, "the shared Score-batch judge exists in the decision slice");
const batchBody = scoredBatchJudge.slice(batchAt);
assert.ok(batchBody.includes("judgeViaPreset({"), "preset mode judges through the shared judge runner");
assert.ok(batchBody.includes("evaluateCall({"), "api mode judges through the shared decision call");
assert.ok(batchBody.includes("resolveScoredVerdicts({"), "both paths resolve through the shared resolver");
assert.ok(!/db\.prepare\("(INSERT|UPDATE|DELETE|REPLACE)/.test(batchBody), "the shared judge writes nothing");

// One working-diff extractor for both advisory judges: verify-tasks and
// gap-triage cannot drift into two different notions of "the evidence".
assert.equal(server.match(/"git",\s*\n\s*\["diff", "HEAD"/g)?.length, 1, "exactly one working-diff extractor exists");
assert.match(server, /function workingDiffFor\(/, "the extractor is shared, not inlined per command");
assert.match(
  taskBody,
  /const diff = await deps\.workingDiffFor\(workspace\.path, TASK_EVIDENCE_DIFF_CHARS\);/,
  "verify-tasks reads its evidence through the shared helper",
);

// Gap triage: escalated gaps are the worker's classification; the judge
// second-opinions genuineness only, never the deterministic routing.
assert.match(
  cliRegistry,
  /"gap-triage",[\s\S]*?Second-opinion escalated critique gaps/,
  "the gap-triage command is listed in the extracted CLI registry",
);
const gapBody = readFileSync(join(root, "server/runtime/cli/cli-gap-triage.ts"), "utf8");
assert.match(gapBody, /argv\[0\] !== "gap-triage"\) return null;/, "the gap-triage family claims exactly its verb");
assert.ok(gapBody.includes("deps.gapState(card)"), "escalated gaps come from the shared registry reader");
assert.ok(gapBody.includes("gapsToTriageBatch("), "the batch maps ids and questions once");
assert.ok(gapBody.includes("judgeScoredBatch({"), "gap triage reuses the shared Score-batch judge");
assert.match(
  gapBody,
  /const evidence = buildGapTriageState\(\{ critiqueText, diff \}\);/,
  "the judge state is exactly the critique plus the diff",
);
assert.ok(gapBody.includes("state: evidence,"), "the evidence reaches the judge, not a bare list of gap wordings");
assert.match(
  gapBody,
  /workingDiffFor\(workspace\.path, TASK_EVIDENCE_DIFF_CHARS\)/,
  "genuineness is judged against the working diff",
);
assert.ok(gapBody.includes("no working-tree diff"), "a missing diff is named, never silently ignored");
assert.ok(gapBody.includes("routing stays deterministic"), "the report states routing is untouched");
assert.ok(!/db\.prepare\("(INSERT|UPDATE|DELETE|REPLACE)/.test(gapBody), "gap-triage makes zero database writes");
assert.ok(!gapBody.includes("realtime.publish"), "gap-triage publishes nothing");
assert.ok(!gapBody.includes("logCardComment"), "gap-triage leaves no comments");

console.log("decision routers test ok: settings discipline, refusal shapes, seam fail-soft, advisory judges");
