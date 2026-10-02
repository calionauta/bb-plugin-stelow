import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { browserStorage, readLastProjectId, rememberUsedProject, resolveDefaultProjectId, writeLastProjectId } from "../lib/last-project.mjs";
import { STORAGE_KEYS } from "../lib/panel-storage.mjs";

// Last-project memory: the creation dialogs seed the SDK composer's project
// picker from the user's previous pick (global per-user key) and persist the
// project each successful submit actually used. Storage is convenience-only,
// so every helper treats a hostile store as absent and never throws.

function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    data,
  };
}

assert.equal(STORAGE_KEYS.lastProject, "stelow-last-project-v1", "the project key is versioned like every other panel key");

// read: absent, blank, and hostile stores all read as null.
assert.equal(readLastProjectId(memoryStore()), null, "empty store reads as absent");
assert.equal(readLastProjectId(memoryStore({ [STORAGE_KEYS.lastProject]: "" })), null, "blank reads as absent");
assert.equal(readLastProjectId(memoryStore({ [STORAGE_KEYS.lastProject]: "proj_b" })), "proj_b", "stored id round-trips");
assert.equal(readLastProjectId(null), null, "no store reads as absent");
assert.equal(readLastProjectId({}), null, "a store without getItem reads as absent");
assert.equal(readLastProjectId({ getItem: () => { throw new Error("denied"); } }), null, "a throwing store reads as absent");

// write: truthy ids persist, blanks never poison the key, hostile stores never throw.
{
  const store = memoryStore();
  writeLastProjectId(store, "proj_b");
  assert.equal(store.data.get(STORAGE_KEYS.lastProject), "proj_b", "truthy id persists");
  writeLastProjectId(store, "");
  writeLastProjectId(store, null);
  writeLastProjectId(store, undefined);
  assert.equal(store.data.get(STORAGE_KEYS.lastProject), "proj_b", "blank writes leave the previous pick intact");
  writeLastProjectId(null, "proj_b");
  writeLastProjectId({ setItem: () => { throw new Error("denied"); } }, "proj_b");
}

// resolve: the remembered pick beats ambient context while it still names a
// known project; anything else falls back to the host context.
assert.equal(resolveDefaultProjectId("proj_a", "proj_b", ["proj_a", "proj_b"]), "proj_b", "stored pick wins when valid");
assert.equal(resolveDefaultProjectId("proj_a", "proj_gone", ["proj_a", "proj_b"]), "proj_a", "unknown stored id falls back to host context");
assert.equal(resolveDefaultProjectId("proj_a", null, ["proj_a"]), "proj_a", "no memory falls back to host context");
assert.equal(resolveDefaultProjectId(null, "proj_b", ["proj_b"]), "proj_b", "memory alone seeds when context is empty");
assert.equal(resolveDefaultProjectId(null, null, []), null, "nothing known resolves to projectless");
assert.equal(resolveDefaultProjectId("proj_a", "proj_b"), "proj_b", "no validation list means the stored pick still wins");
assert.equal(resolveDefaultProjectId("", "", []), null, "blank ids resolve to projectless");

// remember: only real submits persist; projectless submits keep the old pick.
{
  const store = memoryStore({ [STORAGE_KEYS.lastProject]: "proj_a" });
  rememberUsedProject(store, "proj_b");
  assert.equal(store.data.get(STORAGE_KEYS.lastProject), "proj_b", "successful submit persists its project");
  rememberUsedProject(store, null);
  rememberUsedProject(store, "");
  assert.equal(store.data.get(STORAGE_KEYS.lastProject), "proj_b", "projectless submit keeps the previous pick");
}

assert.equal(browserStorage(), null, "no window in node reads as absent storage");

// Wiring pins (topology, not copy): every creation dialog seeds from the
// resolver and persists after success, without growing the recorded submit
// functions the debt ledger pins.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDialog = readFileSync(join(root, "components/creation/create-build-dialog.tsx"), "utf8");
const researchDialog = readFileSync(join(root, "components/creation/create-research-dialog.tsx"), "utf8");
const exploreDialog = readFileSync(join(root, "components/creation/create-explore-dialog.tsx"), "utf8");
for (const [name, source] of [["build", buildDialog], ["research", researchDialog], ["explore", exploreDialog]]) {
  assert.match(source, /useProjectSeed\(\{ activeProjectId, validProjectIds \}\)/, `${name} dialog seeds its project from the shared hook`);
  assert.match(source, /defaultProjectId=\{seedProjectId \?\? undefined\}/, `${name} dialog passes the per-open seed to the composer`);
  assert.match(source, /submitWithMemory\(request, submit\.start\)/, `${name} dialog persists the submitted project`);
}
assert.match(
  readFileSync(join(root, "components/creation/use-project-seed.ts"), "utf8"),
  /resolveDefaultProjectId\(/,
  "the shared seed hook resolves the remembered pick",
);
assert.match(
  readFileSync(join(root, "components/creation/use-project-seed.ts"), "utf8"),
  /rememberUsedProject\(/,
  "the shared seed hook persists after success",
);
assert.match(
  readFileSync(join(root, "components/ui/dialog.tsx"), "utf8"),
  /overflow-x-hidden/,
  "the compact fullscreen shell clips lateral overflow",
);
assert.match(
  readFileSync(join(root, "components/github/github-create-row.tsx"), "utf8"),
  /max-w-full/,
  "the repo select is bounded to its container",
);
