/**
 * Cardless `advance` used to run the helper in project-root mode, so every
 * seeded cardless workflow (`.stelow/<date>/<dir>/state.md`) read as "missing
 * state — reseed". `findSingleLegacyStateDir` is the re-root rule: exactly one
 * match re-roots to it, zero keeps the old behavior, several refuse — guessing
 * would advance the wrong workflow.
 *
 * Runs against the REAL `server/runtime/workflow-state.ts` under
 * `--experimental-strip-types` (dynamic import: the file must load after the
 * SDK shim below registers, since static imports resolve before it). Fixture
 * trees live under `os.tmpdir()`, never in the repo.
 */
import "./cardless-sdk-shim.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { findSingleLegacyStateDir } = await import("../server/runtime/workflow-state.ts");

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "stelow-cardless-"));
  roots.push(root);
  return root;
}

function stateAt(root, ...segments) {
  const dir = join(root, ...segments);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.md"), "---\ncurrent_stage: triage\n---\n");
  return dir;
}

test("a single dated state dir re-roots to exactly that dir", () => {
  const root = fixtureRoot();
  const expected = stateAt(root, ".stelow", "2026-10-22", "sw-x");
  assert.deepEqual(findSingleLegacyStateDir(root), { kind: "single", stateDir: expected });
});

test("a project without .stelow keeps the old project-root behavior", () => {
  assert.deepEqual(findSingleLegacyStateDir(fixtureRoot()), { kind: "none" });
});

test(".stelow with no date dirs is none, not a guess", () => {
  const root = fixtureRoot();
  mkdirSync(join(root, ".stelow"), { recursive: true });
  writeFileSync(join(root, ".stelow", "stelow.json"), "{}\n");
  assert.deepEqual(findSingleLegacyStateDir(root), { kind: "none" });
});

test("two dated state dirs are ambiguous and name the count", () => {
  const root = fixtureRoot();
  stateAt(root, ".stelow", "2026-10-22", "sw-a");
  stateAt(root, ".stelow", "2026-10-22", "sw-b");
  assert.deepEqual(findSingleLegacyStateDir(root), { kind: "ambiguous", count: 2 });
});

test("a date dir without state.md is ignored", () => {
  const root = fixtureRoot();
  mkdirSync(join(root, ".stelow", "2026-10-22", "sw-empty"), { recursive: true });
  assert.deepEqual(findSingleLegacyStateDir(root), { kind: "none" });
});

test("a non-date dir is ignored even when it holds a state.md", () => {
  const root = fixtureRoot();
  stateAt(root, ".stelow", "cache", "x");
  assert.deepEqual(findSingleLegacyStateDir(root), { kind: "none" });
});

console.log("cardless state discovery ok: single re-roots, none keeps project root, several name the count");
