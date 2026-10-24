import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildCard, callsNamed, cliHarness } from "./helpers/cli-harness.mjs";
import { parseGapFrontmatter } from "../lib/gap-registry.mjs";
import { createCritiqueGapState } from "../server/runtime/critique-gap-state.ts";

// `bb stelow gaps` is a VIEW, and a view that lies is worse than no view. It
// reads each card's critique artifacts through the one reader that already
// reads them (`createCritiqueGapState` -> `lib/gap-registry.mjs`), so these
// tests drive that real reader over real files on disk rather than a fake gap
// state: a fake would prove the formatting and nothing about the reading.
//
// Three ways a read-only view lies, one test each:
//   1. zero rows because a filter hid them, reported as zero found;
//   2. a state directory with no card, counted as a card;
//   3. a view that writes.
// Plus the trailer: two keys for the gap record (one with counts, one absent)
// became one key whose numbers are the same findings this command lists.
const root = mkdtempSync(join(tmpdir(), "stelow-gaps-cli-"));

/** A registry row as the skill template writes it: a documented finding is
 * medium/debt, an escalated one is high/new-scope (the misclassification gate
 * would refuse high + documented, and the fixture should be a valid registry). */
function gapRow(resolution, area, description) {
  const escalated = resolution === "escalate";
  return [
    `  - type: ${escalated ? "new-scope" : "debt"}`,
    `    area: ${area}`,
    `    description: "${description}"`,
    `    impact: ${escalated ? "high" : "medium"}`,
    `    effort: ${escalated ? "significant" : "moderate"}`,
    `    resolution: ${resolution}`,
  ];
}

/** A critique report the artifact contract recognises by its title. */
function critique(rows) {
  return ["---", "gaps:", ...rows.flat(), "---", "", "# Execution Critique Report", "", "Body.", ""].join("\n");
}

/** A card's workspace on disk: `state.md` registering each document, and the
 * documents themselves at their registered paths. */
function writeCard(cardId, documents) {
  const stateDir = join(root, cardId, ".stelow/state");
  mkdirSync(stateDir, { recursive: true });
  const registered = [...documents.keys()].flatMap((path) => [
    "  - stage: audit",
    "    kind: artifact",
    "    label: critique",
    `    path: ${path}`,
  ]);
  writeFileSync(join(stateDir, "state.md"), ["---", "artifacts:", ...registered, "---", ""].join("\n"));
  for (const [path, content] of documents) {
    const target = join(root, cardId, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return documents;
}

const card = (id, name) =>
  buildCard({ id, name, display_name: name, dir_hash: `hash_${id}`, kind: "build", status: "in-progress" });
const cardA = card("card_a", "parser");
const cardB = card("card_b", "argv");
const cardDuplicate = card("card_c", "duplicate");
const cardSilent = card("card_d", "silent");

writeCard(cardA.id, new Map([
  ["runs/exec_a/audit/report.md", critique([
    gapRow("documented", "tests/docs-index", "critique rows are never listed anywhere"),
    gapRow("documented", "cli/argv", "the fleet view has no area filter"),
  ])],
]));
writeCard(cardB.id, new Map([
  ["runs/exec_b/audit/report.md", critique([
    gapRow("documented", "tests/docs-index", "docs-index parity is unguarded in CI"),
    gapRow("escalate", "cli/argv", "gaps cannot be grouped by area"),
  ])],
]));
// One finding written into two documents: two registry rows, one finding. This
// is the case the trailer used to count twice while the card listed it once.
writeCard(cardDuplicate.id, new Map([
  ["runs/exec_c/audit/report.md", critique([gapRow("documented", "tests/docs-index", "audit parity is unguarded")])],
  ["runs/exec_c/audit/evidence.md", critique([gapRow("documented", "tests/docs-index", "audit parity is unguarded")])],
]));
// A card with a readable state and no critique at all: nothing was read there,
// which must never be reported as "no gaps".
writeCard(cardSilent.id, new Map([["plans/spec-tech_v1.md", "# Tech plan\n"]]));
// An orphan: a state dir with a valid registry whose card row no longer exists.
// The directory is written exactly like a card's, because that is what the
// export bug saw — a directory it could not attribute to a live card.
const orphan = writeCard("card_orphan", new Map([
  ["runs/exec_o/audit/report.md", critique([
    gapRow("documented", "tests/docs-index", "orphaned finding one"),
    gapRow("documented", "tests/docs-index", "orphaned finding two"),
    gapRow("escalate", "cli/argv", "orphaned finding three"),
  ])],
]));
const orphanPath = join(root, "card_orphan", [...orphan.keys()][0]);

// The repository is created before the first invocation on purpose: a write
// made by an earlier command would otherwise be committed as fixture baseline,
// and the "writes nothing" check would pass straight over it.
execFileSync("git", ["init", "-q"], { cwd: root });
execFileSync("git", ["add", "-A"], { cwd: root });
execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture"], { cwd: root });

/** A harness wired to the fixture: the site's own fleet query answered from
 * `fleet`, the real per-card gap reader over the real files, and every file
 * read recorded so "was this directory ever looked at?" is observable. */
function fixtureHarness(cards, fleet, readPaths) {
  const first = cards[0];
  const harness = cliHarness({ card: first, cards: Object.fromEntries(cards.map((entry) => [entry.id, entry])) });
  harness.deps.db = {
    prepare: (sql) => ({ all: () => (sql.includes("FROM cards") ? fleet : []) }),
  };
  harness.deps.cardWorkspace = async (target) => ({ path: join(root, target.id), hostId: null });
  harness.deps.projectRoot = async () => root;
  harness.deps.workflowStateDir = async (rootPath) => join(rootPath, ".stelow/state");
  harness.deps.bb.sdk.files.read = async ({ path }) => {
    readPaths.push(path);
    return { content: readFileSync(path, "utf8") };
  };
  harness.deps.gapState = createCritiqueGapState({
    bb: harness.deps.bb,
    cardWorkspace: harness.deps.cardWorkspace,
    workflowStateDir: async (target) => join(root, target.id, ".stelow/state"),
    loadCardScopes: () => [],
  });
  return harness;
}

function gitStatus() {
  return execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim();
}

const reads = [];
const fleet = fixtureHarness([cardA, cardB], [cardA, cardB], reads);

// 1. Zero rows is not the same as zero found. The fixture carries 3 documented
//    and 1 escalated finding across two cards: the filter changes what is
//    SHOWN, never what was READ.
const everything = await fleet.invoke(["gaps", "--json"]);
assert.equal(everything.exitCode, 0, `gaps exits 0: ${everything.stderr}`);
const all = JSON.parse(everything.stdout);
assert.equal(all.tally.documented, 3, "3 documented findings were read");
assert.equal(all.tally.escalated, 1, "1 escalated finding was read");
assert.equal(all.shown, 4, "unfiltered shows all four flagged findings");
assert.equal(all.read.cards, 2, "both Build cards were read");
assert.equal(all.read.withoutCritique, 0, "both cards carry a critique");

const onlyEscalated = JSON.parse((await fleet.invoke(["gaps", "--status", "escalated", "--json"])).stdout);
assert.equal(onlyEscalated.shown, 1, "--status escalated lists exactly the one escalated finding");
assert.equal(onlyEscalated.tally.escalated, 1, "--status escalated still reports what was read");
assert.deepEqual(onlyEscalated.areas.map((area) => area.area), ["cli/argv"], "the escalated finding keeps its area");

const onlyDocumented = JSON.parse((await fleet.invoke(["gaps", "--status", "documented", "--json"])).stdout);
assert.equal(onlyDocumented.shown, 3, "--status documented lists the three documented findings");
assert.equal(onlyDocumented.tally.escalated, 1, "a documented view still knows an escalation exists");

const text = await fleet.invoke(["gaps"]);
assert.equal(text.exitCode, 0);
assert.match(text.stdout, /Gaps: 4 total · 0 fixed · 3 documented · 1 escalated/, "the header is the owner's tally");
assert.match(text.stdout, /Cards: 2 read/, "the header says how many cards it read");
assert.match(text.stdout, /^tests\/docs-index — 2 documented$/m, "findings group by area");
const filteredText = await fleet.invoke(["gaps", "--status", "escalated"]);
assert.match(filteredText.stdout, /Areas: 1 · 1 of 4 shown \(--status escalated\)/, "a narrowed view says what it hid");

// An area that matches nothing is a zero SHOWN, never a failure: a view that
// exits non-zero because it found nothing cannot be used in a script.
const unmatched = await fleet.invoke(["gaps", "--area", "cli/argv", "--status", "documented"]);
assert.equal(unmatched.exitCode, 0, "an empty selection still exits 0");
assert.match(unmatched.stdout, /1 of 4 shown \(--status documented --area cli\/argv\)/, "the filter is named");
const wildcard = JSON.parse((await fleet.invoke(["gaps", "--area", "tests/*", "--json"])).stdout);
assert.equal(wildcard.shown, 2, "`*` groups a family of areas");

// 2. An orphan state directory is not a card. The directory holds a valid
//    three-gap registry — parseable, not garbage — and it still changes
//    nothing, because the fleet is enumerated from cards, never from dirs.
assert.equal(parseGapFrontmatter(readFileSync(orphanPath, "utf8")).gaps.length, 3, "the orphan is a real registry");
assert.ok(!reads.some((path) => path.includes("card_orphan")), "an orphan directory is never read");
assert.equal(all.tally.documented + all.tally.escalated, 4, "the orphan adds nothing to the tally");
assert.doesNotMatch(text.stdout, /Unknown card/, "an orphan is not reported as a broken card");

// 3. It writes nothing: a view that writes is a second writer. A real git
//    repository in the fixture root is the surface a write would dirty, and
//    every invocation above already ran against it.
assert.equal(gitStatus(), "", "no invocation above wrote into the fixture repo");
await fleet.invoke(["gaps", "--json"]);
await fleet.invoke(["gaps", "--card", cardA.id]);
assert.equal(gitStatus(), "", "`bb stelow gaps` leaves the fixture repo untouched");
for (const verb of ["write", "mkdir", "updateCard", "comment", "inbox"]) {
  assert.deepEqual(callsNamed(fleet.calls, verb), [], `the view never calls ${verb}`);
}

// 4. The trailer and the command are one record. One finding written into two
//    documents is ONE finding — the row count per document is a different
//    number, and the commit an operator reads a year from now asks this one.
const singleReads = [];
const oneCard = fixtureHarness([cardDuplicate, cardSilent], [], singleReads);
const trailer = await oneCard.invoke(["manifest"]);
const oneCardGaps = JSON.parse((await oneCard.invoke(["gaps", "--card", cardDuplicate.id, "--json"])).stdout);
assert.match(trailer.stdout, /Stelow-Gaps: 0 fixed \/ 1 documented \/ 0 escalated/, "two documents, one finding, one trailer");
assert.equal(oneCardGaps.tally.documented, 1, "and the command reports the same one finding");
assert.equal(oneCardGaps.read.cards, 1, "--card reads exactly the card it names");

// A card nobody audited says so instead of printing a zero it never measured.
const silent = await oneCard.invoke(["manifest", "--card", cardSilent.id]);
assert.match(silent.stdout, /Stelow-Gaps: no execution critique registered/, "an unread card is named, not zeroed");

rmSync(root, { recursive: true, force: true });
console.log("gaps cli test ok: shown vs read, orphans ignored, nothing written, one trailer record");
