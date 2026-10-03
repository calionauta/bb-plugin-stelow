import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The X-ray wiring is split across the modules that own it: the RPC schema
// (card-detail-rpc-contract), the projection (scope-map-reader), and the read
// that feeds it (card-detail). Read each owner rather than a fat composition
// root, so a pin fails only when the piece it names actually moves.
const contract = readFileSync(new URL("../server/card-detail-rpc-contract.ts", import.meta.url), "utf8");
const xrayContract = readFileSync(new URL("../server/scope-xray-contract.ts", import.meta.url), "utf8");
const reader = readFileSync(new URL("../server/scope-map-reader.ts", import.meta.url), "utf8");
const detail = readFileSync(new URL("../server/runtime/card-detail.ts", import.meta.url), "utf8");
const xray = [contract, reader, detail].join("\n");

assert.match(contract, /scopeXray: scopeXraySchema/, "card detail exposes the server-owned X-ray schema");
assert.match(xrayContract, /mutable: z\.literal\(false\)/, "X-ray contract cannot become mutable");
assert.match(xrayContract, /source: z\.literal\("server-projection"\)/, "X-ray identifies its server projection owner");
assert.match(xrayContract, /draft: z\.literal\(true\)/, "the draft marker is a literal, not a settable boolean");
assert.match(contract, /scopeDraft: scopeDraftSchema/, "card detail exposes the draft schema beside the X-ray");
assert.match(reader, /buildScopeXray\(map, \{ currentShapeVersion/, "card detail builds X-ray from the persisted map");
assert.doesNotMatch(xray, /join\(sourcePath, "scope-map\.json"\)/, "card detail never falls back to a shared project-root map");
assert.match(reader, /parseCurrentShapeVersion\(state\)/, "card detail uses card state evidence for freshness");
assert.match(detail, /scopeXray: await readScopeXray|deps\.scopeXray\(stateDir\)/, "card detail reads the X-ray through the scope-map reader");
assert.match(detail, /scopeDraft: await readScopeDraft|deps\.scopeDraft\(stateDir\)/, "card detail reads the draft through the scope-map reader");
assert.match(reader, /scope-map-draft\.json/, "drafts read their own file, never the approved map's");
assert.match(reader, /buildScopeDraft\(map, \{ currentShapeVersion/, "card detail builds drafts through the draft-only projector");

console.log("scope xray wiring test ok: RPC schema, persisted-map source, read-only owner");
