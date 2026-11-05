import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { diagnoseScopeSync } from "../lib/spec-scope-reader.mjs";
import { detailScopeSync } from "../server/runtime/card-scope-sync.ts";

const SPEC = `# Zoë’s reviewed plan\n\n${[1, 6, 7, 8, 9].map((id) => `[SCOPE-${id}] Scope ${id}\n[TYPE] feature\n`).join("\n")}`;
const sha = (content) => createHash("sha256").update(content, "utf8").digest("hex");
const NEW_FILE = "spec-tech_v3.md";
const OLD_FILE = "spec-tech_v2.md";
const MATCH = { specFile: NEW_FILE, syncedSpecFile: NEW_FILE, specSha256: sha(SPEC), syncedSpecSha256: sha(SPEC) };

const diagnoses = [
  ["a newer plan with an old populated tracker is unsynced", { ...MATCH, syncedSpecFile: OLD_FILE, syncedCount: 9 }, "unsynced"],
  ["a known target plan with null tracked identity is unsynced", { ...MATCH, syncedSpecFile: null }, "unsynced"],
  ["a known target plan with absent tracked identity is unsynced", { ...MATCH, syncedSpecFile: undefined }, "unsynced"],
  ["an edited-in-place plan is unsynced despite matching filename and count", { ...MATCH, syncedSpecSha256: "a".repeat(64) }, "unsynced"],
  ["exact persisted filename and raw-byte hash match", MATCH, "ok"],
  ["legacy callers without version metadata retain count-based behavior", {}, "ok"],
  ["matching version without a legacy recorded hash remains compatible", { ...MATCH, syncedSpecSha256: undefined }, "ok"],
  ["a recorded hash cannot match an unknown current hash", { ...MATCH, specSha256: undefined }, "unsynced"],
];
for (const [label, metadata, state] of diagnoses) {
  test(label, () => {
    const result = diagnoseScopeSync({ specContent: SPEC, syncedCount: 5, ...metadata });
    assert.equal(result.state, state);
    assert.equal(result.machine, 5);
    assert.equal(result.synced, metadata.syncedCount ?? 5);
  });
}

test("missing source content cannot become green from populated tracking metadata", () => {
  const result = diagnoseScopeSync({ specContent: null, syncedCount: 9, ...MATCH });
  assert.equal(result.state, "no-spec");
});

function tree(root) {
  return readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? tree(path).map(([name, content]) => [join(entry.name, name), content])
      : [[entry.name, readFileSync(path).toString("base64")]];
  });
}

function workspace(t, metadata, count = 5) {
  const root = mkdtempSync(join(tmpdir(), "scope-sync-provenance-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const owner = {
    name: "same-display-name", workflowId: "card_expected", dirHash: "owner", created: "2026-11-05T06:00:00Z",
    scopes: Array.from({ length: count }, (_, index) => ({ id: `scope-${index + 1}`, status: "pending" })),
    ...metadata,
  };
  const decoy = { ...owner, workflowId: "card_other", dirHash: "other", specTechFile: NEW_FILE, specTechSha256: sha(SPEC) };
  for (const workflow of [owner, decoy]) {
    const plans = join(root, ".stelow", "2026-11-05", workflow.dirHash, "plans");
    mkdirSync(plans, { recursive: true });
    writeFileSync(join(plans, OLD_FILE), "# Historical plan\n");
    writeFileSync(join(plans, NEW_FILE), SPEC);
  }
  writeFileSync(join(root, "stelow.json"), `${JSON.stringify({ workflows: [decoy, owner], receipt: "preserve-original" }, null, 2)}\n`);
  return root;
}

const runtimeCases = [
  ["different persisted plan", { specTechFile: OLD_FILE, specTechSha256: "a".repeat(64) }, 9, "unsynced"],
  ["same plan edited in place", { specTechFile: NEW_FILE, specTechSha256: "a".repeat(64) }, 5, "unsynced"],
  ["exact plan and content", { specTechFile: NEW_FILE, specTechSha256: sha(SPEC) }, 5, "ok"],
  ["missing persisted identity", {}, 9, "unsynced"],
];
for (const [label, metadata, count, state] of runtimeCases) {
  test(`real card projection uses its owner's persisted provenance: ${label}`, (t) => {
    const root = workspace(t, metadata, count);
    const before = tree(root);
    const result = detailScopeSync({ id: "card_expected", kind: "build" }, root, count);
    assert.equal(result.state, state);
    assert.equal(result.machineBlocks, 5);
    assert.equal(result.syncedScopes, count);
    assert.equal(result.specFile, NEW_FILE);
    assert.deepEqual(tree(root), before, "projection may not repair, migrate or overwrite any state");
  });
}

test("the projection does not borrow another card's plan when ownership is missing", (t) => {
  const root = workspace(t, MATCH);
  const result = detailScopeSync({ id: "missing_card", kind: "build" }, root, 5);
  assert.equal(result.state, "no-spec");
});
