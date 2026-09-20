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
assert.match(server, /mode TEXT NOT NULL CHECK \(mode IN \('rules', 'api'\)\)/, "stored modes are closed to rules/api");

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
assert.ok(setterBody.includes("DECISION_PROVIDERS.join"), "provider refusals name the valid set");

// Point writes refuse unknown ids and modes with the valid set named;
// reads degrade to registry defaults instead of refusing.
const pointSetter = handlerBody("async setDecisionPoint({ point, mode, thresholds }) {");
assert.ok(pointSetter.includes("Unknown decision point"), "unknown points refuse");
assert.ok(pointSetter.includes("Available: ${DECISION_POINTS"), "point refusals name the valid set");
assert.ok(pointSetter.includes("Unknown mode"), "unknown modes refuse");
assert.ok(pointSetter.includes("STELOW_DECISION_API=0"), "api-mode writes refuse naming the variable");
const pointGetter = handlerBody("async getDecisionPoint({ point }) {");
assert.ok(pointGetter.includes("normalizePointMode("), "reads normalize unknown modes to rules");
const listBody = handlerBody("async listDecisionPoints() {");
assert.ok(listBody.includes("DECISION_POINTS.map("), "the list derives from the registry — never a pasted copy");

// Execution seam: build creations consult the router exactly once, and the
// router fails soft to "unknown" on every path (mode gate, missing key,
// catch-all) so creation never breaks for a misconfigured point.
assert.match(server, /explicitIntent !== "unknown" \? explicitIntent : await seedBuildIntentFromRouter\(prompt\)/, "explicit caller intent wins; otherwise the router seeds, else triage settles");
const seamAt = server.indexOf("async function seedBuildIntentFromRouter(promptText: string): Promise<string> {");
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
assert.match(app, /Built-in rules \(default\)/, "rules read as the default outcome");
assert.match(app, /point\.mode === "api"/, "threshold controls render only for api-mode points");
assert.match(app, /Act at confidence/, "thresholds read as confidence floors");
assert.match(app, /<span>Model<\/span><Input/, "the Decision API model field is a free-text input (external ids live outside BB's catalog)");
assert.match(app, /<option value="classifier">classifier\.dev \(labels, keyless\)<\/option>/, "the provider select offers classifier");
assert.match(app, /<option value="jev">TypeSafe AI(&apos;|')s Jev \(state \+ questions\)<\/option>/, "the provider select keeps jev (no one-way door)");
assert.match(app, /Any endpoint speaking the Jev schema works — key \+ model required/, "the settings state the schema requirement in one line");
assert.match(app, /if \(endpoint === otherDefault\)/, "custom endpoint URLs survive provider flips (only pristine defaults swap)");
assert.ok(seamBody.includes("endpoint: cfg?.endpoint ?? defaultEndpointFor(provider)"), "the seam sends the stored endpoint, defaulting only when blank");
assert.doesNotMatch(app, /preset-thread/i, "no thread jargon survives in the UI");

console.log("decision routers test ok: settings discipline, refusals, seam fail-soft, UI disclosure");
