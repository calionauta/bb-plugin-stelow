import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const xraySource = readFileSync(new URL("../components/detail/scope-xray.tsx", import.meta.url), "utf8");
const progressSource = readFileSync(new URL("../components/detail/build-progress.tsx", import.meta.url), "utf8");
assert.match(xraySource, /export function ScopeXray\(/, "card detail has a Scope X-ray view");
assert.match(xraySource, /Read-only · \{xray\.freshness\}/, "X-ray discloses read-only freshness");
assert.match(progressSource, /detail\.scopeXray \? <ScopeXray/, "card detail renders the server projection when present");
assert.match(xraySource, /Server projection of the approved map; it does not change scope/, "X-ray explains its no-mutation boundary");

console.log("scope xray UI test ok: read-only presentation, freshness, wiring");
