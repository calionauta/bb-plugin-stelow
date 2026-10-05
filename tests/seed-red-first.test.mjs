import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedWorkflow } from "../server/runtime/workflow-seeding.ts";

// The seed writes an explicit red_first into state.md + tracking config,
// and writes nothing when the knob is absent (absent means "derive from
// quality downstream", never an invented mode). Real seedWorkflow against
// tmp dirs with a stubbed file bridge — no helper, no network.
const bb = {
  sdk: {
    files: {
      read: async () => ({ content: "" }),
    },
  },
};

const KNOBS = {
  quality: "production",
  supervisor: "high",
  explorationCount: 3,
  explorationHybrid: true,
};

function trackingOf(dir) {
  return JSON.parse(readFileSync(join(dir, "stelow.json"), "utf8"));
}

test("seed writes an explicit red_first to state.md and tracking config", async () => {
  const dir = mkdtempSync(join(tmpdir(), "seed-red-first-"));
  try {
    const seed = await seedWorkflow(bb, dir, "card_1", "slug", "feature", { ...KNOBS, redFirst: "off" }, []);
    assert.equal(seed.error, null);
    assert.ok(seed.statePath, "a state path is returned");
    const state = readFileSync(seed.statePath, "utf8");
    assert.match(state, /^\s*red_first: off$/m, "state.md carries the explicit mode");
    const entry = trackingOf(dir).workflows[0];
    assert.equal(entry.config.red_first, "off", "tracking config carries the explicit mode");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("seed without redFirst writes no red_first anywhere", async () => {
  const dir = mkdtempSync(join(tmpdir(), "seed-red-first-"));
  try {
    const seed = await seedWorkflow(bb, dir, "card_2", "slug", "feature", { ...KNOBS }, []);
    assert.equal(seed.error, null);
    const state = readFileSync(seed.statePath, "utf8");
    assert.doesNotMatch(state, /red_first/, "state.md carries no red_first line");
    const config = trackingOf(dir).workflows[0].config;
    assert.ok(!("red_first" in config), "tracking config carries no red_first key");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
