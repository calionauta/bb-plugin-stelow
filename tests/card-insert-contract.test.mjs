import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Card creation is shared by Build, Research, and Explore. Keep its SQL shape
// derived from one column list so a new field cannot break every creation flow.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "server.ts"), "utf8");
const insertBlock = source.match(/const CARD_COLUMNS = \[(?<columns>[^\]]+)\];[\s\S]*?const cardValues = \[[\s\S]*?\];[\s\S]*?cardValues\.length !== CARD_COLUMNS\.length[\s\S]*?INSERT INTO cards \(\$\{CARD_COLUMNS\.join\([\s\S]*?CARD_COLUMNS\.map\(\(\) => "\?"\)\.join/s);

assert.ok(insertBlock?.groups?.columns, "card INSERT declares one canonical column list");
const columns = JSON.parse(`[${insertBlock.groups.columns}]`);
assert.equal(columns.length, 24, "card INSERT has the expected 24 columns");
assert.equal(new Set(columns).size, columns.length, "card INSERT columns are unique");
assert.match(source, /cardValues\.length !== CARD_COLUMNS\.length/, "card INSERT rejects a values/columns mismatch");

console.log("card insert contract test ok: placeholders derive from 24 unique columns");
