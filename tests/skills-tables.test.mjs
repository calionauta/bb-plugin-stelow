import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findInvalidTableDelimiters } from "../lib/skills-tables.mjs";

// Regression: the State Coverage Table template shipped a `:---:+`
// delimiter (stray `+`), which no GFM renderer recognizes — every
// generated table rendered as raw pipes in the artifact viewer.
const broken = [
  "| Component | Type | Idle |",
  "|-----------|:----:|:---:+|",
  "| Casa | Int | ✅ |",
].join("\n");
assert.deepEqual(
  findInvalidTableDelimiters(broken).map((p) => p.line),
  [2],
  "flags the stray-plus delimiter row",
);

const fixed = [
  "| Component | Type | Idle |",
  "|-----------|:----:|:---:|",
  "| Casa | Int | ✅ |",
].join("\n");
assert.deepEqual(findInvalidTableDelimiters(fixed), [], "accepts valid centered delimiters");

// Fenced ASCII sketches contain pipes but are not tables.
const fenced = ["```", "|  X  |", "|-----+", "```"].join("\n");
assert.deepEqual(findInvalidTableDelimiters(fenced), [], "ignores fenced code blocks");

// Every vendored skill doc must only contain tables a GFM renderer parses,
// since workers copy these formats verbatim into artifacts.
const skillsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else if (entry.name.endsWith(".md")) out.push(abs);
  }
  return out;
}
const offenders = [];
for (const file of walk(skillsDir)) {
  for (const problem of findInvalidTableDelimiters(readFileSync(file, "utf8"))) {
    offenders.push(`${file}:${problem.line} [${problem.cells.join(" | ")}]`);
  }
}
assert.equal(offenders.length, 0, `invalid GFM table delimiters in vendored skills:\n${offenders.join("\n")}`);

console.log("skills tables test ok: delimiter regression covered, vendored skills scan clean");
