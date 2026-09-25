import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
assert.match(server, /scopeXray: z\.object\(/, "card detail exposes the server-owned X-ray schema");
assert.match(server, /buildScopeXray\(scopeMap/, "card detail builds X-ray from the persisted map");
assert.doesNotMatch(server, /nodeJoin\(sourcePath, "scope-map\.json"\)/, "card detail never falls back to a shared project-root map");
assert.match(server, /currentShapeVersion: parseCurrentShapeVersion\(stateText\)/, "card detail uses card state evidence for freshness");
assert.match(server, /mutable: z\.literal\(false\)/, "X-ray contract cannot become mutable");
assert.match(server, /source: z\.literal\("server-projection"\)/, "X-ray identifies its server projection owner");

console.log("scope xray wiring test ok: RPC schema, persisted-map source, read-only owner");
