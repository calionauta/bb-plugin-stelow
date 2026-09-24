import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  asPresetReasoningLevel,
  modeLabel,
  PRESET_REASONING_LEVELS,
} from "../components/settings/preset-execution-values.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "app.tsx"), "utf8");

assert.deepEqual(
  [...PRESET_REASONING_LEVELS],
  ["low", "medium", "high", "xhigh", "max", "none", "ultra", "ultracode"],
  "the host reasoning catalog keeps its supported levels",
);
for (const level of PRESET_REASONING_LEVELS) {
  assert.equal(
    asPresetReasoningLevel(level),
    level,
    `the host picker preserves the supported ${level} level`,
  );
}
for (const value of ["", "medium-high", "LEGACY", " undefined "]) {
  assert.equal(
    asPresetReasoningLevel(value),
    "medium",
    `legacy reasoning value ${JSON.stringify(value)} falls back to medium`,
  );
}

assert.equal(modeLabel("api"), "Decision API", "API mode names its external source");
assert.equal(modeLabel("preset"), "Preset judge", "preset mode names its saved source");
for (const value of ["rules", "", "unknown"]) {
  assert.equal(
    modeLabel(value),
    "Built-in rules (default)",
    `unknown mode ${JSON.stringify(value)} keeps the built-in default`,
  );
}

assert.match(
  app,
  /import \{ modeLabel \} from "\.\/components\/settings\/preset-execution-values\.mjs"/,
  "decision routing consumes the tested mode-label helper",
);
assert.doesNotMatch(
  app,
  /function (?:asPresetReasoningLevel|modeLabel)\(/,
  "normalization helpers no longer live in the app shell",
);

console.log("preset execution picker test ok: catalog normalization, mode labels, and settings ownership");
