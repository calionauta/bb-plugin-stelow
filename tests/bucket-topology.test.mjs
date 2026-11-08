import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOf } from "./helpers/source-code.mjs";

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
  assert.equal((control.match(/<textarea/g) ?? []).length, 1, "and the shared control owns exactly one");
  assert.match(control, /from "@\/components\/ui\/button"/, "its actions use the shared Button, not raw elements");
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

test("BoardCard supports selection for bulk bucket actions", () => {
  // Read with comments stripped: two assertions below guard the ABSENCE of names this
  // file explains in prose, and a comment naming them would satisfy a raw-source match.
  const board = codeOf(read("components/board/board-cards.tsx"));
  assert.match(board, /export function BoardCard\(/, "BoardCard exists");
  assert.match(board, /selected\?/, "BoardCard supports selection prop for bucket bulk");
  assert.match(board, /onToggleSelection/, "BoardCard has selection toggle for bucket");
  // The parked-edit sheet is gone, and this pin guards its absence. Editing a parked card
  // happens in the card itself — title inline in the header, description through the prompt
  // control, provider through the preset dialog — so the sheet was a second entry point for
  // four forms that already existed, and it drifted from them.
  assert.doesNotMatch(
    board,
    /EditParkedSheet|canEdit/,
    "the tile carries no parked-edit affordance: a bucket card is edited inside the card",
  );
  assert.doesNotMatch(
    board,
    /onClick=\{\(event\) => \{ event\.stopPropagation\(\); onEdit\(\); \}\}/,
    "and no Edit button survives on the tile",
  );
});

/**
 * The gallery modal sizes itself to its cards, and its grid has no phantom columns.
 *
 * Reported from a screenshot of the Bucket: four cards huddled left inside a modal that
 * stayed wide, with a large void to their right. Two causes, both in the class strings:
 *
 *   1. `auto-fill` creates phantom tracks to fill the width, so a row of four cards in a
 *      wide modal reserved the empty columns as real tracks and every tile aligned left.
 *   2. The modal was `sm:w-[70vw]` — a width chosen for a full grid, which reads as a
 *      mistake when the bucket holds four cards.
 *
 * Pinned on the CLASS rather than on a screenshot, because that is what a future edit
 * changes, and read from the code with the repo's comment-stripping helper so the
 * explanation above cannot satisfy it.
 */
test("the gallery grid collapses empty tracks and the modal follows its content", () => {
  const gallery = codeOf(read("components/board/card-gallery.tsx"));
  assert.match(
    gallery,
    /repeat\(auto-fit,minmax\(min\(240px,100%\),320px\)\)/,
    "the tile grid uses auto-fit, so empty columns collapse instead of leaving the cards huddled left",
  );
  assert.doesNotMatch(
    gallery,
    /auto-fill/,
    "and never auto-fill, which reserves empty columns as real tracks — the void in the report",
  );
  assert.doesNotMatch(
    gallery,
    /w-\[70vw\]|max-w-\[70vw\]/,
    "and the modal no longer takes a fixed share of the viewport, which stayed wide for four cards",
  );
  assert.match(
    gallery,
    /sm:max-w-\[min\(92vw,64rem\)\]/,
    "its width is bounded by a readable measure and the viewport, so a small bucket sits narrow and a large one grows",
  );
});

test("updateCardPrompt is a contracted RPC with handler-owned length gate", () => {
  assert.match(contract, /updateCardPrompt: \{\s*\n\s*experimental_description: "Edit a parked card's description/, "prompt edit is a contracted RPC");
  const entry = contract.match(/updateCardPrompt: \{[^}]*?prompt: (z\.string\(\.[^)]*\)|z\.string\(\)) \}\)/);
  assert.ok(entry, "updateCardPrompt declares a prompt input");
  assert.equal(entry[1], "z.string()", "raw .max would reject padded-but-legal inputs before the handler trims — length is the handler's gate");
});
