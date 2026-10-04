import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Topology pins for the bucket naming + parked prompt feature. Each pin
// constrains wiring, counts, or refusals and names the regression it
// catches — never copy, never existence for its own sake.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const heroes = [
  "components/detail/build-detail-hero.tsx",
  "components/detail/research-detail-content.tsx",
  "components/detail/explore-detail-content.tsx",
];
const SINGLE_NAMER_NOTE = "a second slicing helper breaks the single-namer invariant";
const GALLERY_NOTE = "the bucket gallery never names on its own — creation owns titles";
const NO_BURST_NOTE = "a burst call in the mutation reintroduces the double-burst hazard";
const ATOMIC_WRITE_NOTE = "prompt and title refresh land in one atomic write";
const OPTIONAL_HOOK_NOTE = "the hook stays optional so legacy harnesses keep today's behavior";
const heroSources = heroes.map(read);
const control = read("components/detail/prompt-edit-control.tsx");
const mutations = read("server/runtime/card-mutations.ts");
const workers = read("server/workers.ts");
const contract = read("server/card-rpc-contract.ts");

test("one shared prompt editor serves all three detail heroes", () => {
  for (const [index, source] of heroSources.entries()) {
    assert.match(source, /import \{ PromptEdit \} from "\.\/prompt-edit-control"/, `${heroes[index]} imports the shared control instead of owning an editor`);
    assert.match(source, /<PromptEdit cardId=\{card\.id\}/, `${heroes[index]} renders the shared control with the card`);
  }
  assert.doesNotMatch(heroSources.join("\n"), /<textarea/, "no hero owns a track-local textarea — the shared control is the only editor");
});

test("exactly one sync namer with an allowlisted call-site set", () => {
  const lib = read("lib/draft-burst.mjs");
  const definitions = lib.match(/export function heuristicDisplayName/g) ?? [];
  assert.equal(definitions.length, 1, SINGLE_NAMER_NOTE);
  const callers = ["server/cards-create.ts", "server/runtime/card-mutations.ts", "lib/card-naming.mjs"]
    .map((path) => ({ path, source: read(path) }));
  for (const { path, source } of callers) {
    assert.match(source, /heuristicDisplayName\(/, `${path} reuses the shared namer`);
  }
  const gallery = read("components/board/card-gallery.tsx");
  assert.doesNotMatch(gallery, /heuristicDisplayName|validateCardName/, GALLERY_NOTE);
});

test("prompt save never spawns: the burst site stays Start-only", () => {
  assert.doesNotMatch(mutations, /suggestCardName|spawnDisposable|spawnTitle/, NO_BURST_NOTE);
  const write = /UPDATE cards SET prompt = \?, display_name = \?, updated_at = \? WHERE id = \?/;
  assert.match(mutations, write, ATOMIC_WRITE_NOTE);
});

test("Start re-fire runs on start only, never restart", () => {
  assert.match(workers, /if \(reason === "start"\) refreshUnsettledTitle\(deps, card\);/, "the title hook is gated to fresh starts");
  assert.equal((workers.match(/refreshUnsettledTitle\(deps, card\)/g) ?? []).length, 1, "a second call site (restart/retry) overwrites settled titles");
  const hook = /titleRefresh\?: \{ request: \(\(cardId: string\) => void\) \| null \}/;
  assert.match(workers, hook, OPTIONAL_HOOK_NOTE);
});

test("updateCardPrompt is a contracted RPC with handler-owned length gate", () => {
  assert.match(contract, /updateCardPrompt: \{\s*\n\s*experimental_description: "Edit a parked card's description/, "prompt edit is a contracted RPC");
  const entry = contract.match(/updateCardPrompt: \{[^}]*?prompt: (z\.string\(\.[^)]*\)|z\.string\(\)) \}\)/);
  assert.ok(entry, "updateCardPrompt declares a prompt input");
  assert.equal(entry[1], "z.string()", "raw .max would reject padded-but-legal inputs before the handler trims — length is the handler's gate");
});
