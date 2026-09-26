import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TECHNIQUE_CATALOG, techniqueById } from "../lib/stage-catalog.mjs";
import { contractForExplore } from "../lib/artifact-contracts.mjs";
import { validateExplore } from "../lib/artifact-validation.mjs";
import { exploreArtifactFile } from "../lib/research-artifacts.mjs";

/**
 * Interface Contrast as a standalone Explore technique.
 *
 * The objection that kept this out was that a decision needs an owner, and
 * Explore has no `selection` stage to own the pick. That objection does not
 * hold, and the reason is mechanical rather than a matter of taste: the Explore
 * card detail already renders `DetailQuestionSections`, the same component
 * Build cards use, so a structured question with options, per-option
 * documents, previews and staleness works there today. The pick is recorded on
 * the card. What Explore cannot do is own a decision that becomes a build,
 * which is why the blurb says so out loud.
 *
 * Explore also dispatches a SKILL, not a recipe, so the recipe capability gate
 * that gates the Build track never applies here.
 */

const technique = techniqueById("interface-contrast");

// The technique exists and delegates to the method's own skill.
assert.ok(technique, "Interface Contrast is available in Explore");
assert.equal(technique.skill, "stelow-workflow-interface-contrast", "Explore delegates to the reaction-first method skill");
assert.ok(TECHNIQUE_CATALOG.some((entry) => entry.id === "interface-contrast"), "it is in the Explore catalog");
assert.deepEqual(technique.optionalEvidence, ["interfaces/contrast.json"], "the machine receipt is optional and never replaces the readable document");

// The premise the entry rests on, asserted rather than assumed. This is the
// wiring that cannot be extracted to lib/: the card detail must render the
// shared question surface, or the pick has nowhere to land.
const exploreContent = readFileSync(new URL("../components/detail/explore-detail-content.tsx", import.meta.url), "utf8");
assert.match(
  exploreContent,
  /<DetailQuestionSections/,
  "the Explore card renders the shared question surface, so a structured pick has somewhere to land",
);
assert.match(
  exploreContent,
  /DetailQuestionSections[\s\S]{0,400}detail=\{detail\}/,
  "and it is fed the card's own detail, not a stub",
);
// A substring pin cannot tell a rendered element from a dead branch, and
// disabling the surface is exactly how this entry would rot: the technique
// would still be in the catalog with nowhere to record a pick. So the guard
// itself is pinned.
assert.doesNotMatch(
  exploreContent,
  /\{\s*(false|0|null|undefined)\s*&&\s*<DetailQuestionSections/,
  "the question surface is not rendered behind a permanently-false guard",
);

// A technique with no deliverable contract is a technique the quality seal
// cannot judge, which is how a card ends up marked done on nothing.
const contract = contractForExplore("interface-contrast");
assert.ok(contract, "the technique has a deliverable contract");
assert.equal(contract.minWords, 250, "the floor is below a real rendering's 380 words and far above a stub");

// The contract must accept a faithful contrast. Interface Contrast is a bounded
// comparison, so its rendering is short and table-free; a contract copied from
// interface-alternatives (800 words, 2 table rows) would fail real work and
// stamp "missing or thin" on a document that is neither.
// A faithful rendering is ~380 words in the real run, so the fixture has to be
// that shape too. A condensed skeleton is not a weaker test of the contract --
// it is a different claim, and a 250-word floor is supposed to reject it.
const faithful = [
  "# Scope Map placement \u2014 readable contrast",
  "",
  "## Decision",
  "Where does the approved Scope Map become visible to someone reading a Build card?",
  "Authority: agent recommendation, product-significant placement deferred to Shape.",
  "",
  "## Fixed constraints (non-negotiable)",
  "- The map stays in canonical stage data. No parallel scope state, no second lifecycle.",
  "- The Scope stage keeps ownership of the approved map; Shape may only propose candidate slices.",
  "- Scope IDs, ownership, IN/OUT boundaries and dependency meaning do not change with placement.",
  "- A map challenge is a named artifact with a destination, never an in-place mutation.",
  "",
  "## Option A \u2014 Extend the existing Scope stage",
  "Add a headed Scope Map section inside the Scope stage view, above the slice list. Keeps the reader's",
  "eye where it already goes for scope questions, and adds no new concept to teach. The cost is that the",
  "map is only visible while the card sits in Scope, so a reader arriving later from Execution has to",
  "navigate back to find it.",
  "",
  "## Option B \u2014 Separate user-visible concept",
  "Surface the map as its own first-class object with its own panel, independent of the stage that owns it.",
  "The concept is clean and the map is reachable from anywhere on the card. The cost is a new thing to",
  "learn for readers who only wanted a slice list, and a second place to keep in sync with the stage view.",
  "",
  "## Option C \u2014 Attention lanes with a collapsed summary",
  "Group slices by whether they carry an open decision, and collapse the rest to one line each. Fastest to",
  "scan for the common case, and it degrades badly for a reader who needs the dependency order rather than",
  "the decision state, because the collapsed lines carry no ordering.",
  "",
  "## Ruled out",
  "Mutations and dependency inference were ruled out: they belong to planning, not to placement, and",
  "putting them here would give the map a second job.",
  "",
  "## Evidence",
  "- scope-map.json already assumes an Extend-style placement, so Option A is a contract assumption",
  "  rather than a new policy decision.",
  "- The spec v2 shape carries the same assumption, which is the strongest signal available here.",
  "- No measured evidence exists for the collapsed variant; it is argued from scan cost alone.",
  "",
  "## Next action",
  "Carry Option A into Shape as a named constraint on the Scope stage view, and record the placement",
  "assumption explicitly so a later reader does not rediscover it. Product approval of the placement is",
  "not this document's to give.",
].join("\n");
const okResult = validateExplore("interface-contrast", faithful);
assert.equal(okResult.pass, true, `a faithful contrast passes: ${JSON.stringify(okResult.failures)}`);

// And it must reject a stub, or the contract is decoration.
const stub = validateExplore("interface-contrast", "# Interface Contrast\n\nNothing here.\n");
assert.equal(stub.pass, false, "a stub fails the contract");
const codes = stub.failures.map((failure) => failure.code);
assert.ok(codes.includes("thin"), "the stub is caught for being thin");
assert.ok(codes.includes("missing-section"), "and for missing the sections the method requires by name");
assert.ok(codes.includes("too-few-headings"), "and for having no options to compare");

// A comparison with sections but no options is not a comparison.
const noOptions = validateExplore(
  "interface-contrast",
  `${faithful}\n\n## Ruled out\n\nNothing was ruled out, which is itself the finding.`.replace(
    /## Option A[\s\S]*?## Option C[\s\S]*?(?=## Ruled out)/,
    "",
  ),
);
assert.equal(noOptions.pass, false, "a rendering with no option headings is refused — that is not a comparison");

// The deliverable name resolves through the shared resolver, like every other
// technique, so the seal and the prompt cannot disagree about it.
assert.equal(exploreArtifactFile("interface-contrast"), "explore-interface-contrast.md", "it uses the catalog convention, so nothing has to be declared");

// The options requirement must not depend on ONE spelling. A faithful contrast
// may name its options "Option A" or "Proposal A" — both occur in real briefs,
// in the same document set on one card — and requiring the word "Option" failed
// a correct document for using the other name.
// A real two-option contrast runs shorter than a three-option one, so the
// fixture is written to the depth the method asks for rather than trimmed to
// fit: a 250-word floor is calibrated on the real 380-word rendering, and
// lowering the floor to admit a short fixture would admit thin work.
const byProposalNameText = [
    "# Scope Map placement — readable contrast",
    "",
    "## Decision",
    "Where does the approved Scope Map become visible to someone reading a Build card?",
    "",
    "## Fixed constraints (non-negotiable)",
    "- The map stays in canonical stage data. No parallel scope state, no second lifecycle.",
    "- The Scope stage keeps ownership of the approved map; Shape may only propose candidate slices.",
    "- Scope IDs, ownership, IN/OUT boundaries and dependency meaning do not change with placement.",
    "- A map challenge is a named artifact with a destination, never an in-place mutation.",
    "- Whatever the placement, the map must be read-only: a reader never edits a decision here.",
    "",
    "## Proposal A — Extend the existing Scope stage",
    "Add a headed Scope Map section inside the Scope stage view, above the slice list, so the map",
    "sits where a reader already goes when they ask what a build contains. This keeps the",
    "reader's eye where it is and adds no new concept to teach, and it needs no second surface to",
    "keep in sync because there is no second surface. The cost is that the map is only visible",
    "while the card sits in Scope: a reader arriving later from Execution has to navigate back to",
    "find it, which is exactly the moment they are most likely to want it.",
    "",
    "## Proposal B — Separate user-visible concept",
    "Surface the map as its own first-class object with its own panel, independent of the stage",
    "that owns it, so the map is reachable from anywhere on the card and its lifecycle is legible",
    "at a glance. The concept is clean and the placement question stops depending on which stage",
    "the card happens to be in. The cost is a new thing to learn for readers who only wanted a",
    "slice list, a second place to keep in sync with the stage view, and a second surface to keep",
    "correct as the map's shape changes.",
    "",
    "## Evidence",
    "- scope-map.json already assumes an Extend-style placement, so Proposal A is a contract",
    "  assumption rather than a new policy decision.",
    "- The spec v2 shape carries the same assumption, which is the strongest signal available here.",
    "- No measured evidence exists for the separate-concept variant; it is argued from legibility",
    "  alone, so a reader should treat it as the weaker of the two on present evidence.",
    "",
    "## Next action",
    "Carry Proposal A into Shape as a named constraint on the Scope stage view, and record the",
    "placement assumption explicitly so a later reader does not rediscover it. Product approval of",
    "the placement is not this document's to give.",
].join("\n");

const byProposalName = validateExplore("interface-contrast", byProposalNameText);
assert.equal(
  byProposalName.pass,
  true,
  `a contrast that names its options "Proposal A" is faithful, not defective: ${JSON.stringify(byProposalName.failures)}`,
);
// And the requirement still bites. The no-options variant is DERIVED from the
// one above by removing only the option sections, so length and the three
// required sections are identical and the missing options are the only possible
// reason it fails. A hand-written stub would have failed for being thin, and
// would have proved nothing about this rule.
const withoutOptions = byProposalNameText
  .replace(/## Proposal A[\s\S]*?(?=## Evidence)/, "")
  .replace(/## Proposal B[\s\S]*?(?=## Evidence)/, "");
const noOptionHeadings = validateExplore("interface-contrast", withoutOptions);
assert.doesNotMatch(
  withoutOptions,
  /^## (Proposal|Option|Alternative|Direction|Variant) /m,
  "the derivation actually removed the option sections, and only those",
);
assert.match(withoutOptions, /## Evidence/, "and left the required sections in place");
assert.equal(
  noOptionHeadings.pass,
  false,
  `a comparison with no options is refused, and only for that reason: ${JSON.stringify(noOptionHeadings.failures)}`,
);
assert.ok(
  noOptionHeadings.failures.some((failure) => failure.code === "too-few-headings"),
  "the refusal names the missing options specifically, so a thin document and an optionless one are told apart",
);
// Control: the same derivation with the option sections kept must pass, or the
// derivation itself is what the test is measuring.
assert.equal(validateExplore("interface-contrast", byProposalNameText).pass, true, "the untrimmed body passes");

console.log("explore interface contrast test ok: technique, deliverable contract, and the question surface the pick lands on");
