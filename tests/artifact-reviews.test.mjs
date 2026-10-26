/**
 * A reviewed mark is bound to a version of the artifact, not to a boolean.
 *
 * What regresses if these fail: a mark made before the file changed reads as
 * current, so the card tells a reviewer they have read a version they have
 * not — the same lie the decision receipts exist to stop. The second half is
 * the door: the mark must be derivable from the artifact list the card
 * renders, and the fingerprint must come from the SERVER, never the caller.
 *
 * Three layers, because they fail differently: the pure derivation
 * (`reviewState`), the store (upsert / clear / per-card isolation), and the two
 * RPC doors (refusals that name their exit, a server-resolved fingerprint, and
 * no side effect on the card).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { reviewLine, reviewState } from "../lib/artifact-review.mjs";
import { artifactReviewRpcContract } from "../server/artifact-review-rpc-contract.ts";
import { createCardLifecycleHandlers } from "../server/runtime/card-lifecycle.ts";
import {
  ARTIFACTS_UNAVAILABLE,
  ARTIFACT_NOT_ON_CARD,
  createArtifactReviewHandlers,
  markArtifactReviewed,
  reviewMarks,
  unmarkArtifactReviewed,
} from "../server/runtime/artifact-reviews.ts";
import { card } from "./helpers/card-detail-fixture.mjs";
import { freshDatabase, insertCard } from "./helpers/artifact-review-db.mjs";

const FRESH = "2026-10-25T10:00:00.000Z";
const CHANGED = "2026-10-25T11:30:00.000Z";

const artifact = (path, generatedAt = FRESH) => ({ path, generatedAt });

// ---------------------------------------------------------------------------
// The derivation
// ---------------------------------------------------------------------------

const DERIVATION_CASES = [
  {
    name: "no marks: nothing is reviewed",
    artifacts: [artifact("a.md"), artifact("b.md")],
    marks: new Map(),
    expected: {
      rows: [{ path: "a.md", reviewed: false, stale: false }, { path: "b.md", reviewed: false, stale: false }],
      reviewedCount: 0,
      total: 2,
      stale: [],
      line: "0 of 2 reviewed",
    },
  },
  {
    name: "every mark matches: all reviewed",
    artifacts: [artifact("a.md"), artifact("b.md")],
    marks: new Map([["a.md", FRESH], ["b.md", FRESH]]),
    expected: {
      rows: [{ path: "a.md", reviewed: true, stale: false }, { path: "b.md", reviewed: true, stale: false }],
      reviewedCount: 2,
      total: 2,
      stale: [],
      line: "2 of 2 reviewed",
    },
  },
  {
    name: "one mark names an older version: stale, and not counted as reviewed",
    artifacts: [artifact("a.md", CHANGED), artifact("b.md")],
    marks: new Map([["a.md", FRESH]]),
    expected: {
      rows: [{ path: "a.md", reviewed: false, stale: true }, { path: "b.md", reviewed: false, stale: false }],
      reviewedCount: 0,
      total: 2,
      stale: ["a.md"],
      line: "0 of 2 reviewed · 1 reviewed before the file changed",
    },
  },
  {
    name: "a mark whose artifact left the list is ignored, never resurrected",
    artifacts: [artifact("a.md")],
    marks: new Map([["gone.md", FRESH], ["a.md", FRESH]]),
    expected: {
      rows: [{ path: "a.md", reviewed: true, stale: false }],
      reviewedCount: 1,
      total: 1,
      stale: [],
      line: "1 of 1 reviewed",
    },
  },
  {
    name: "a mark for an unknown path cannot inflate the count",
    artifacts: [],
    marks: new Map([["ghost.md", FRESH]]),
    expected: { rows: [], reviewedCount: 0, total: 0, stale: [], line: null },
  },
  {
    name: "single artifact, unmarked",
    artifacts: [artifact("only.md")],
    marks: new Map(),
    expected: {
      rows: [{ path: "only.md", reviewed: false, stale: false }],
      reviewedCount: 0,
      total: 1,
      stale: [],
      line: "0 of 1 reviewed",
    },
  },
  {
    name: "stale and fresh together",
    artifacts: [artifact("a.md", CHANGED), artifact("b.md"), artifact("c.md", CHANGED)],
    marks: new Map([["a.md", FRESH], ["b.md", FRESH], ["c.md", FRESH]]),
    expected: {
      rows: [
        { path: "a.md", reviewed: false, stale: true },
        { path: "b.md", reviewed: true, stale: false },
        { path: "c.md", reviewed: false, stale: true },
      ],
      reviewedCount: 1,
      total: 3,
      stale: ["a.md", "c.md"],
      line: "1 of 3 reviewed · 2 reviewed before the file changed",
    },
  },
  {
    name: "null inputs are an empty card, not a crash",
    artifacts: null,
    marks: null,
    expected: { rows: [], reviewedCount: 0, total: 0, stale: [], line: null },
  },
];

for (const entry of DERIVATION_CASES) {
  test(entry.name, () => {
    assert.deepEqual(reviewState(entry.artifacts, entry.marks), entry.expected);
  });
}

test("the sentence has one owner, and an empty card has no progress to report", () => {
  assert.equal(reviewLine(0, 0, 0), null);
  assert.equal(reviewLine(2, 5, 1), "2 of 5 reviewed · 1 reviewed before the file changed");
});

test("the equality is the whole rule: a changed timestamp is stale, never fresh", () => {
  // Invert the comparison in lib/artifact-review.mjs and this must fail.
  const [row] = reviewState([artifact("a.md", CHANGED)], new Map([["a.md", FRESH]])).rows;
  assert.equal(row.reviewed, false, "a fingerprint that differs is not a reviewed file");
  assert.equal(row.stale, true, "and it is not silently forgotten — the mark exists");
});

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/** The lifecycle's own bag, stubbed to the parts deletion touches. */
function lifecycleDeps(db, row) {
  return {
    db,
    bb: { realtime: { publish: () => undefined } },
    getCard: (cardId) => (cardId === row.id ? row : undefined),
    cardWorkspace: async () => null,
    workflowStateDir: async () => null,
    workers: { stop: async () => undefined, deleteCard: () => undefined },
    stopOwnedRuns: async () => true,
    cancelScopeBatches: () => undefined,
    updateCard: () => undefined,
    releaseClaims: async () => undefined,
    removeCardPreset: () => undefined,
    logCardComment: () => "comment",
    runGitIn: async () => ({ ok: true, stdout: "" }),
    exploratoryScope: "/tmp/exploratory",
    discardEvidence: async () => ({}),
    discardEligibility: () => ({ eligible: false, action: "none", reason: null }),
    discardConfirm: () => ({ title: "", body: "" }),
    discardTrail: () => "",
    errors: { cardNotFound: "Card not found." },
  };
}

test("the store upserts one row, clears it, and keeps cards apart", () => {
  const db = freshDatabase();
  insertCard(db, card({ id: "card_a" }));
  insertCard(db, card({ id: "card_b" }));
  markArtifactReviewed(db, "card_a", "a.md", FRESH, 10);
  markArtifactReviewed(db, "card_a", "a.md", CHANGED, 20);
  const row = db.prepare("SELECT COUNT(*) AS n, MAX(reviewed_at) AS at, MAX(reviewed_fingerprint) AS fingerprint "
    + "FROM artifact_reviews WHERE card_id = ?").get("card_a");
  assert.deepEqual(row, { n: 1, at: 20, fingerprint: CHANGED },
    "marking twice refreshes the one row instead of stacking a second claim");
  assert.deepEqual([...reviewMarks(db, "card_a")], [["a.md", CHANGED]]);
  assert.equal(reviewMarks(db, "card_b").size, 0, "a second card cannot see this card's marks");
  unmarkArtifactReviewed(db, "card_a", "a.md");
  assert.equal(reviewMarks(db, "card_a").size, 0, "clearing the mark removes it");
  unmarkArtifactReviewed(db, "card_a", "never-marked.md");
  assert.equal(reviewMarks(db, "card_a").size, 0, "clearing an absent mark is a no-op, not a failure");
  db.close();
});

test("deleting a card deletes its marks, even though SQLite does not enforce the FK", async () => {
  const db = freshDatabase();
  const row = card({ id: "card_gone", status: "archived" });
  insertCard(db, row);
  markArtifactReviewed(db, row.id, "a.md", FRESH, 10);
  const handlers = createCardLifecycleHandlers(lifecycleDeps(db, row));
  const result = await handlers.deleteCard({ cardId: row.id });
  assert.deepEqual(result, { deleted: true, error: null });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cards WHERE id = ?").get(row.id).n, 0);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM artifact_reviews WHERE card_id = ?").get(row.id).n,
    0,
    "an orphan mark would outlive the only card that could open it",
  );
  db.close();
});

// ---------------------------------------------------------------------------
// The two doors
// ---------------------------------------------------------------------------

function handlersFor(db, { row, artifacts }) {
  const published = [];
  const deps = {
    db,
    now: () => 42,
    getCard: (cardId) => (row.id === cardId ? row : undefined),
    readArtifacts: async () => artifacts(),
    publish: (cardId) => published.push(cardId),
    errors: { cardNotFound: "Card not found.", cardArchived: "This card is archived." },
  };
  return { handlers: createArtifactReviewHandlers(deps), published };
}

test("both doors refuse an unknown card and an archived card, by name", async () => {
  const db = freshDatabase();
  const archived = card({ id: "card_archived", status: "archived" });
  insertCard(db, archived);
  const { handlers } = handlersFor(db, { row: archived, artifacts: () => [artifact("a.md")] });
  assert.deepEqual(await handlers.markArtifactReviewed({ cardId: "missing", path: "a.md" }),
    { ok: false, error: "Card not found." });
  assert.deepEqual(await handlers.unmarkArtifactReviewed({ cardId: "missing", path: "a.md" }),
    { ok: false, error: "Card not found." });
  assert.deepEqual(await handlers.markArtifactReviewed({ cardId: "card_archived", path: "a.md" }),
    { ok: false, error: "This card is archived." });
  assert.deepEqual(await handlers.unmarkArtifactReviewed({ cardId: "card_archived", path: "a.md" }),
    { ok: false, error: "This card is archived." },
    "the reversible door refuses an archived card too — a mark on a closed card is a fact, not an editable one");
  db.close();
});

test("a path the card does not carry is refused with the door that lists them", async () => {
  const db = freshDatabase();
  const row = card({ id: "card_live" });
  insertCard(db, row);
  const { handlers, published } = handlersFor(db, { row, artifacts: () => [artifact("a.md")] });
  const result = await handlers.markArtifactReviewed({ cardId: row.id, path: "not-on-card.md" });
  assert.deepEqual(result, { ok: false, error: ARTIFACT_NOT_ON_CARD });
  assert.match(result.error, /Artifacts section/, "the refusal names where the list lives");
  assert.equal(reviewMarks(db, row.id).size, 0, "a refused mark writes nothing");
  assert.deepEqual(published, [], "and it publishes nothing");
  db.close();
});

test("an unreadable workspace is UNKNOWN, not 'this card has no artifacts'", async () => {
  const db = freshDatabase();
  const row = card({ id: "card_live" });
  insertCard(db, row);
  const { handlers } = handlersFor(db, { row, artifacts: () => null });
  const result = await handlers.markArtifactReviewed({ cardId: row.id, path: "a.md" });
  assert.deepEqual(result, { ok: false, error: ARTIFACTS_UNAVAILABLE });
  assert.notEqual(result.error, ARTIFACT_NOT_ON_CARD, "a host failure must not send the reader to an empty section");
  assert.equal(reviewMarks(db, row.id).size, 0);
  db.close();
});

test("the stored fingerprint is the artifact the server read NOW, never the caller's", async () => {
  const db = freshDatabase();
  const row = card({ id: "card_live" });
  insertCard(db, row);
  let version = FRESH;
  const { handlers, published } = handlersFor(db, {
    row,
    artifacts: () => [artifact("a.md", version)],
  });
  const cardBefore = db.prepare("SELECT stage, status, activity FROM cards WHERE id = ?").get(row.id);
  const acceptedResult = await handlers.markArtifactReviewed({ cardId: row.id, path: "a.md" });
  assert.deepEqual(acceptedResult, { ok: true, error: null });
  assert.deepEqual([...reviewMarks(db, row.id)], [["a.md", FRESH]]);
  assert.deepEqual(published, [row.id], "the open card is told to refresh");
  assert.deepEqual(db.prepare("SELECT stage, status, activity FROM cards WHERE id = ?").get(row.id), cardBefore,
    "a mark is a fact about a file: it moves no stage and changes no activity");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inbox_events").get().n, 0,
    "and it resolves no inbox event");

  // The file moves. The old mark is now a claim about a version the card no
  // longer shows, and a second mark records the new one.
  version = CHANGED;
  const afterChange = reviewState([artifact("a.md", version)], reviewMarks(db, row.id));
  assert.deepEqual(afterChange.stale, ["a.md"], "the old mark reads stale, not fresh");
  // A caller that smuggles its own fingerprint past the wire (the contract
  // refuses it; this calls the handler directly) must not be believed.
  const forged = await handlers.markArtifactReviewed({
    cardId: row.id,
    path: "a.md",
    reviewed_fingerprint: FRESH,
  });
  assert.deepEqual(forged, { ok: true, error: null });
  assert.deepEqual([...reviewMarks(db, row.id)], [["a.md", CHANGED]],
    "marking again stores the server's current fingerprint, not the caller's");

  const cleared = await handlers.unmarkArtifactReviewed({ cardId: row.id, path: "a.md" });
  assert.deepEqual(cleared, { ok: true, error: null });
  assert.equal(reviewMarks(db, row.id).size, 0);
  db.close();
});

test("clearing a mark is allowed after the artifact leaves the card's list", async () => {
  // The file a mark names may be deleted or renamed away; refusing its removal
  // would leave a row nobody can clean up, and its absence already keeps it out
  // of the count. This pins the door rather than the implementation.
  const db = freshDatabase();
  const row = card({ id: "card_live" });
  insertCard(db, row);
  const { handlers } = handlersFor(db, { row, artifacts: () => [] });
  assert.deepEqual(await handlers.unmarkArtifactReviewed({ cardId: row.id, path: "gone.md" }),
    { ok: true, error: null });
  db.close();
});

test("the RPC input cannot carry a fingerprint, by contract", () => {
  // A client-supplied fingerprint is how an old mark would be written as
  // current. `.strict()` refuses the extra key at the wire.
  const parsed = artifactReviewRpcContract.markArtifactReviewed.input.safeParse({
    cardId: "card_live",
    path: "a.md",
    reviewed_fingerprint: FRESH,
  });
  assert.equal(parsed.success, false, "the fingerprint is the server's to resolve");
});

console.log("artifact reviews ok: a mark is bound to a version, and the server owns it");
