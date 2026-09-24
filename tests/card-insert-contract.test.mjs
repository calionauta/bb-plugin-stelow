import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Card creation is shared by Build, Research, and Explore. Keep its SQL shape
// derived from one column list so a new field cannot break every creation flow.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "server/cards-create-persist.ts"), "utf8");
const insertBlock = source.match(/const CARD_COLUMNS = \[(?<columns>[^\]]+)\];[\s\S]*?function cardValues\([\s\S]*?\n\}/);

assert.ok(insertBlock?.groups?.columns, "card INSERT declares one canonical column list");
const columns = JSON.parse(`[${insertBlock.groups.columns.replace(/,\s*$/, "")}]`);
assert.equal(columns.length, 25, "card INSERT has the expected 25 columns");
assert.equal(new Set(columns).size, columns.length, "card INSERT columns are unique");
assert.match(source, /values\.length !== CARD_COLUMNS\.length/, "card INSERT rejects a values/columns mismatch");

console.log("card insert contract test ok: placeholders derive from 25 unique columns");
