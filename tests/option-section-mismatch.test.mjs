import assert from "node:assert/strict";
import { optionSectionExcerpt, sectionHeadingsMatch } from "../lib/option-anchor.mjs";
import { createAskArtifacts, optionCoverage, pickOptionDocument } from "../server/runtime/ask-artifacts.ts";

/**
 * The case a reader actually hit.
 *
 * The card's question offered three layouts and a hybrid: "Hybrid A+C", "A
 * stacked blocks", "B compact table", "C attention lanes". Clicking any of them
 * opened a document and scrolled to **Option A** — and Option A was not even one
 * of the offered choices, let alone the hybrid.
 *
 * Two defects, both reproduced here from the real documents.
 *
 * The document the host opened is reproduced verbatim in shape below: it is a
 * *different decision* (where the map is placed) with two options, while the
 * question asked about *how the map is laid out* with three layouts and a
 * hybrid, which lived in a sibling file.
 */

// The document the host actually opened: placement, two options, no hybrid.
const placementBrief = [
  "# Scope Map placement — readable contrast",
  "",
  "## Fixed constraints (non-negotiable)",
  "The map stays in canonical stage data.",
  "",
  "## What the view must do (either placement)",
  "Be findable from the card without leaving the stage.",
  "",
  "## Option A — Extend the existing Scope stage",
  "Keeps orientation where readers already go for scope questions.",
  "",
  "## Option B — Separate user-visible concept",
  "Clean concept, but a new thing to teach.",
  "",
  "## Ruled out",
  "Mutations and dependency inference belong to planning.",
  "",
  "## Evidence",
  "scope-map.json assumes an Extend-style placement.",
  "",
  "## Next action",
  "Carry the placement into Shape as a named constraint.",
].join("\n");

const questionLabels = ["Hybrid A+C", "A stacked blocks", "B compact table", "C attention lanes"];

// DEFECT 1, mine: the letter route matched a DIFFERENT option's heading.
// "Hybrid A+C" and "Option A — Extend the existing Scope stage" share the letter
// "a", and the route fired on it — so the reader was sent to Option A when they
// clicked the hybrid. The letter route exists for a brief that names options by
// letter ALONE ("## Proposal A"); it must not fire on a heading that describes
// an option.
for (const label of questionLabels) {
  assert.equal(
    optionSectionExcerpt(placementBrief, label),
    null,
    `"${label}" resolves to NO section of a document about a different decision — never to another option's section`,
  );
}
// The two functions answer different questions and must not be conflated.
// `optionSectionExcerpt` scans raw text for the option's section and owns the
// letter route. `sectionHeadingsMatch` compares a heading the host RENDERED
// against the heading the scan already resolved, so by then both sides are full
// headings and word coverage is the right rule.
assert.equal(
  sectionHeadingsMatch("Option A — Extend the existing Scope stage", "Hybrid recommendation (A + C)"),
  false,
  "a heading that DESCRIBES an option never matches a different option's heading",
);

// The letter route, through the function that owns it: a brief that names its
// options by letter alone must still be readable, or the route cannot be
// restricted at all.
const letterOnlyBrief = [
  "# Interface proposals",
  "",
  "## Proposal A",
  "Stacked per-scope blocks in dependency order.",
  "",
  "## Proposal B",
  "One table row per scope.",
  "",
  "## Proposal C",
  "Needs-decision lanes first.",
].join("\n");
assert.equal(
  optionSectionExcerpt(letterOnlyBrief, "A stacked blocks")?.heading,
  "Proposal A",
  "a bare option marker still routes, or a brief naming options by letter could not be read at all",
);
assert.equal(
  optionSectionExcerpt(letterOnlyBrief, "C attention lanes")?.heading,
  "Proposal C",
  "including for a letter that is not the label's first",
);

// DEFECT 2, the host's: two documents of the same stage were registered and the
// recovery took the first, so every option opened the wrong one. With the right
// document, all four options resolve — the hybrid included.
const layoutBrief = [
  "# Scope Map interface proposals (v1, Core: 3 + hybrid)",
  "",
  "## Proposal A — Stacked per-scope blocks (dependency order)",
  "Stacked per-scope blocks in dependency order.",
  "",
  "## Proposal B — Compact table (one row per scope)",
  "Dense table layout.",
  "",
  "## Proposal C — Attention lanes (needs-decision first)",
  "Needs-decision lanes first.",
  "",
  "## Hybrid recommendation (A + C)",
  "Stacked blocks in attention order. Table density is sacrificed.",
  "",
  "## Out (all proposals)",
  "Mutations, dependency inference, decision input UI.",
].join("\n");

for (const label of questionLabels) {
  const found = optionSectionExcerpt(layoutBrief, label);
  assert.ok(found, `"${label}" resolves in the document the options were written from`);
}
const hybrid = optionSectionExcerpt(layoutBrief, "Hybrid A+C");
assert.match(hybrid.heading, /Hybrid recommendation/, "the hybrid resolves to the hybrid, not to Proposal A");
assert.doesNotMatch(hybrid.body, /Proposal A —/, "and its section does not leak another proposal's text");

// Nothing here depends on the reader's spelling: the label is the card's, the
// heading is the brief's, and they are written by different steps.
assert.equal(optionSectionExcerpt(layoutBrief, "hybrid a+c").line, hybrid.line, "case and spacing do not decide it");

// DEFECT 2, the host side: a stage registered BOTH documents and the recovery
// took the first, so every option opened the placement contrast. It now scores
// each candidate by how many of the ask's options that document actually names.
const PLACEMENT = "interfaces/interfaces.md";
const LAYOUT = "interfaces/interfaces_v1.md";
const scores = new Map([
  [PLACEMENT, optionCoverage(placementBrief, questionLabels)],
  [LAYOUT, optionCoverage(layoutBrief, questionLabels)],
]);
assert.deepEqual([...scores], [[PLACEMENT, 0], [LAYOUT, 4]], "the wrong document names none of the options; the right one names all four");
assert.equal(
  pickOptionDocument([{ path: PLACEMENT }, { path: LAYOUT }], scores),
  LAYOUT,
  "so the recovery opens the document the options were written from, not the first one registered",
);
assert.equal(
  pickOptionDocument([{ path: LAYOUT }, { path: PLACEMENT }], scores),
  LAYOUT,
  "and the same document wins regardless of manifest order",
);
const tied = new Map([[PLACEMENT, 0], [LAYOUT, 0]]);
assert.equal(pickOptionDocument([{ path: PLACEMENT }, { path: LAYOUT }], tied), PLACEMENT, "an undecidable stage keeps the first document");
assert.equal(pickOptionDocument([{ path: LAYOUT }, { path: PLACEMENT }], tied), LAYOUT, "and keeps it in manifest order");
assert.equal(optionCoverage(null, questionLabels), 0, "absent content scores zero instead of throwing the recovery away");
assert.equal(optionCoverage("", questionLabels), 0, "empty content scores zero");
assert.equal(optionCoverage(placementBrief, []), 0, "no labels means nothing to match");

// The pure functions above cannot reach two hops of wiring, and both hops are
// what put the reader on the wrong document in the first place. Driven through
// the recovery the host actually runs: `fallbackGateAskArtifact` is called with
// the ask's own labels, reads the stage manifest, and must return the document
// that names them — never the first one registered. The labels reaching the
// recovery and the scored choice both ride this one call, so a regression that
// dropped either would open the placement contrast instead.
const STATE_DIR = "/w/.stelow/2026-09-24/hash1";
const FILES = {
  "/w/stelow.json": JSON.stringify({
    workflows: [{ workflowId: "card_1", dirHash: "hash1", created: "2026-09-24T00:00:00.000Z" }],
  }),
  [`${STATE_DIR}/state.md`]: [
    "---",
    "workflow_id: card_1",
    "current_stage: interface",
    "---",
    "",
    "artifacts:",
    "  - stage: interface",
    "    kind: document",
    "    path: interfaces/interfaces.md",
    "  - stage: interface",
    "    kind: document",
    "    path: interfaces/interfaces_v1.md",
    "",
  ].join("\n"),
  "/w/interfaces/interfaces.md": placementBrief,
  "/w/interfaces/interfaces_v1.md": layoutBrief,
};

const asks = createAskArtifacts({
  bb: {
    sdk: {
      files: {
        read: async ({ path }) => {
          if (!(path in FILES)) throw new Error(`ENOENT ${path}`);
          return { content: FILES[path] };
        },
      },
    },
  },
  db: { prepare: () => ({ run: () => undefined, get: () => undefined, all: () => [] }) },
  now: () => 0,
  getCard: () => undefined,
  cardWorkspace: async () => ({ path: "/w", hostId: "host1" }),
  cardStageSlug: async () => "int-gate",
  gitEvidence: async () => ({ gitRoot: "/w", headSha: null }),
  sha256OfHostFile: async () => null,
});

const recovered = await asks.fallbackGateAskArtifact({ id: "card_1", dir_hash: "hash1" }, questionLabels);
assert.equal(
  recovered?.path,
  "interfaces/interfaces_v1.md",
  "the ask's own labels reach the manifest recovery and select the document that names them, not the first registered",
);

// With no labels there is nothing to score, so the recovery keeps manifest
// order — the old behaviour, for an ask that names no options.
const unlabeled = await asks.fallbackGateAskArtifact({ id: "card_1", dir_hash: "hash1" }, []);
assert.equal(unlabeled?.path, "interfaces/interfaces.md", "an unwritten-from ask keeps the first registered document");

// The live card_g89gtmwt shape: the worker attached the RECEIPT
// (`interfaces.md`), which names none of the four options, while the proposals
// file names all four. The attachment is replaced, not inherited onto every
// row, so the brief button opens the document the options were written from.
const card = { id: "card_1", dir_hash: "hash1" };
const attachedReceipt = await asks.resolveAskOptions(
  card,
  questionLabels.map((label) => ({
    label,
    description: "",
    preview: null,
    artifact: { path: "interfaces/interfaces.md" },
  })),
);
assert.equal(
  attachedReceipt[0]?.artifact?.path,
  "interfaces/interfaces_v1.md",
  "an attachment that names none of the options yields to the proposals file that names them",
);
assert.ok(
  attachedReceipt.every((option) => option.artifactInherited === true),
  "the recovered document is marked inherited, because no option attached it",
);

// The exception that makes the rule safe: an approval gate attaches a plan
// whose options are Approve/Request changes. The plan names neither, and no
// sibling names them either, so the deliberate attachment must survive.
const approval = await asks.resolveAskOptions(card, [
  { label: "Approve", description: "", preview: null, artifact: { path: "interfaces/interfaces.md" } },
  { label: "Request changes", description: "", preview: null, artifact: null },
]);
assert.equal(
  approval[0]?.artifact?.path,
  "interfaces/interfaces.md",
  "with no positive candidate, the worker's attachment is kept instead of replaced by manifest order",
);

console.log("option-section-mismatch test ok: a different decision's document yields no section, and the right one yields the hybrid");
