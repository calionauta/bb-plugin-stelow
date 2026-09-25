import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.tsx", import.meta.url), "utf8");
assert.match(app, /function ScopeXray\(/, "card detail has a Scope X-ray view");
assert.match(app, /Read-only · \{xray\.freshness\}/, "X-ray discloses read-only freshness");
assert.match(app, /detail\?\.scopeXray \? <ScopeXray/, "card detail renders the server projection when present");
assert.match(app, /Server projection of the approved map; it does not change scope ownership\./, "X-ray explains its no-mutation boundary");

console.log("scope xray UI test ok: read-only presentation, freshness, wiring");
