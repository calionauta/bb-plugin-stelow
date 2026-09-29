import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { blockedFileWait, lockBlockEvent, lockBlockSummary, lockBlockDedupeKey, lockWaitCopy, lockWaitHero, scopeClaimLines } from "../lib/lock-blocked.mjs";
import { ensureInboxResolvedReasonColumn, insertInboxEvent, listInboxEvents } from "../lib/inbox-events.mjs";
import { ensureInboxOccurrencesColumn } from "../lib/inbox-error-event.mjs";

/**
 * A blocked file must name the blocker as something you can OPEN.
 *
 * The sentence already said `held by card "Restore archived cards to board
 * columns"`, and that was the whole of it. A reader who wanted to know what
 * that card was doing to the file had to copy a display name and hunt it on a
 * board of dozens — doing the join the system had already done and thrown away,
 * because `lockBlockedSummary` took a display NAME and a file and returned a
 * string, and the holder's id was dropped at the call site.
 *
 * Same shape as the execution reconciler recording `unknown-native-state` where
 * a known state was in hand: one fact, two representations, and the one that
 * survives is the one that cannot be used. So the record is the truth, the
 * prose is derived from it, and the link is built from the id — never by
 * re-finding the name inside the sentence, which is a link that eventually
 * points at the wrong card and fails by still looking right.
 */
const repoRoot = join(fileURLToPath(import.meta.url), "..", "..");
const read = (relative) => readFileSync(join(repoRoot, relative), "utf8");

const block = {
  cardId: "card_blocked",
  file: "src/foo.ts",
  holderCardId: "card_holder",
  holderName: "Restore archived cards to board columns",
  expiresAt: Date.UTC(2026, 8, 28, 12, 0, 0),
};

function database() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE cards (id TEXT PRIMARY KEY, display_name TEXT, name TEXT NOT NULL, project_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'build');
    CREATE TABLE inbox_events (
      id TEXT PRIMARY KEY, card_id TEXT NOT NULL, kind TEXT NOT NULL,
      summary TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, occurred_at INTEGER NOT NULL,
      read_at INTEGER, archived_at INTEGER, resolved_at INTEGER,
      severity INTEGER NOT NULL DEFAULT 1, severity_reasons TEXT NOT NULL DEFAULT '[]',
      holder_card_id TEXT, holder_file TEXT,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );
  `);
  ensureInboxResolvedReasonColumn(db);
ensureInboxOccurrencesColumn(db);
  db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?, ?)").run(
    "card_blocked", "Blocked", "blocked", "project_1", "build",
  );
  return db;
}

test("the record is the truth and the sentence is derived from it", () => {
  const event = lockBlockEvent(block);
  assert.equal(event.summary, lockBlockSummary(block), "one function writes both, so they cannot disagree");
  assert.match(event.summary, /src\/foo\.ts/);
  assert.match(event.summary, /Restore archived cards to board columns/);
  assert.match(event.summary, /no action needed/, "the mechanism really is automatic; implying homework trains distrust");
  assert.equal(event.dedupeKey, lockBlockDedupeKey(block));
  assert.equal(event.dedupeKey, "lock-blocked:card_blocked:src/foo.ts", "one notification per card per file, however often it retries");
});

test("the holder survives to the row as an id, not only as a name in prose", () => {
  const db = database();
  const event = lockBlockEvent(block);
  insertInboxEvent(db, {
    id: "evt_lock", cardId: "card_blocked", kind: "paused",
    summary: event.summary, dedupeKey: event.dedupeKey, occurredAt: 1,
    holder: { cardId: event.holderCardId, file: event.holderFile },
  });
  const row = listInboxEvents(db, false)[0];
  assert.equal(row.holder_card_id, "card_holder", "the affordance is the id the system already had");
  assert.equal(row.holder_file, "src/foo.ts");
  assert.match(row.summary, /Restore archived cards/, "and the sentence is still there to be read");
  db.close();
});

test("an event with no holder stays null rather than inventing one", () => {
  const db = database();
  insertInboxEvent(db, {
    id: "evt_plain", cardId: "card_blocked", kind: "error",
    summary: "Worker failed.", dedupeKey: "error:card_blocked:2", occurredAt: 2,
  });
  const row = listInboxEvents(db, false)[0];
  assert.equal(row.holder_card_id, null, "no holder is null, not an empty string the UI would render as a broken link");
  assert.equal(row.holder_file, null);
  db.close();
});

test("the inbox row links the holder, and cannot be built from the sentence", () => {
  // Navigation is wired by the panel; the chip's own behaviour lives in its own
  // file, so each is asserted where it lives.
  const panel = read("components/panels/inbox-panel.tsx");
  // The panel owns the router and the row does not know navigation exists, so
  // the assertion is on the ID reaching the router — not on the exact call
  // shape, which the row is free to refactor.
  assert.match(
    panel,
    /goToHolderCard\(navigate, entry\.holderCardId/,
    "navigation must take the holder's id, never its name",
  );
  assert.doesNotMatch(
    panel,
    /inboxEventText\(entry\)\.match|split\("card "|replace\(.*held by/,
    "the holder must not be recovered out of the prose; a link parsed from a sentence eventually points at the wrong card",
  );
  const chip = read("components/panels/inbox-holder-chip.tsx");
  // The chip is a control inside a row that is itself a button, so it has to
  // stop propagation or it navigates twice and lands on the card the reader
  // was already on.
  assert.match(
    chip,
    /event\.stopPropagation\(\);\s*\n\s*onOpen\(\);/,
    "the holder link is nested inside the row's own button and must not double-navigate",
  );
  assert.match(
    chip,
    /<button[\s\S]*onClick=/,
    "the holder is a real control, not styled text — it has to be reachable by keyboard",
  );
  assert.match(
    chip,
    /min-h-11/,
    "and it is a 44px target like every other control on the card",
  );
});

test("the old formatter is gone, not merely unused", () => {
  // The formatter took a display name and returned a string, which is the shape
  // that lost the id. Leaving it around invites the next caller to use it.
  for (const file of ["server/runtime/claim-coordination.ts", "server/runtime/cli/cli-deps.ts", "server/runtime/wiring/cli-surfaces.ts"]) {
    assert.doesNotMatch(read(file), /lockBlockedSummary/, `${file} still carries the formatter that dropped the id`);
  }
});

/**
 * The card knew a scope had claims and nothing else.
 *
 * The file names were dropped at the boolean on the way to the panel, so the
 * open card could say "files claimed" and never say which files, and said
 * nothing at all about the case a reader most needs: another card is holding
 * a file this one is waiting on. The Inbox had that the whole time, on a
 * different screen — one fact, two surfaces, and the card was the one that
 * could not be used.
 */
test("the card's wait is derived from the same per-scope record the Inbox reads", () => {
  const scopes = [
    { blockedFiles: [{ file: "src/foo.ts", heldBy: "card_holder", expiresAt: 2_000 }] },
    { blockedFiles: [{ file: "src/bar.ts", heldBy: "card_holder", expiresAt: 1_000 }] },
    { blockedFiles: [{ file: "src/baz.ts", heldBy: "card_other", expiresAt: 3_000 }] },
  ];
  const wait = blockedFileWait(scopes, (id) => `name of ${id}`);
  assert.deepEqual(wait.files, ["src/foo.ts", "src/bar.ts", "src/baz.ts"], "every blocked file is named, in the order the scopes report them");
  assert.deepEqual(wait.holders, ["card_holder", "card_other"], "every holder is carried, so the card can link all of them");
  assert.equal(wait.holderCardId, "card_holder", "the holder blocking the most files leads the sentence");
  assert.equal(wait.holderName, "name of card_holder", "the name is resolved by the caller, the id is never parsed from prose");
  assert.equal(wait.expiresAt, 3_000, "the latest lease is the one that matters for the backstop");
  assert.equal(blockedFileWait([{ blockedFiles: [] }], (id) => id), null, "a free card has no wait to show");
  assert.equal(blockedFileWait([], (id) => id), null, "no scopes is no wait");
  assert.equal(blockedFileWait(null, null), null, "junk is no wait, never a crash");
  assert.equal(wait.internal, false, "a foreign holder makes this a cross-card wait, and holders links it");
  assert.match(
    lockWaitCopy(wait),
    /at the latest/,
    "the expiry the Inbox sentence promises is not dropped on the card: the lease is the backstop, stated the same way",
  );
});

// A sibling scope of the same card is contention, but the reader cannot go
// and unblock another card — and a sentence naming their own card would point
// them at themselves. It is named as what it is, and offers no link.
test("a wait on a sibling scope names the scope, not the reader's own card", () => {
  const internal = blockedFileWait(
    [{ blockedFiles: [{ file: "src/shared.ts", heldBy: "card_self", heldScope: "b1::scope-2", holderLabel: "another scope on this card", expiresAt: 2_000 }] }],
    () => "This card",
  );
  assert.deepEqual(internal.files, ["src/shared.ts"], "the file is still named");
  assert.deepEqual(internal.holders, [], "and there is no card to link to");
  assert.equal(internal.internal, true, "the wait is internal");
  assert.equal(internal.holderName, "another scope on this card", "not the reader's own card name");
  assert.doesNotMatch(lockWaitCopy(internal), /This card/, "the sentence never blames the reader's own card");
  assert.match(lockWaitCopy(internal), /another scope on this card/, "it names the real holder");

  // A mixed wait: a sibling AND a foreign card. The foreign one is the lead
  // (it is the one the reader can act on), but the sibling's file is still in
  // `files`, because the card waits on all of them.
  const mixed = blockedFileWait(
    [
      { blockedFiles: [{ file: "a.ts", heldBy: "card_self", heldScope: "b1::scope-2", holderLabel: "another scope on this card", expiresAt: 1_000 }] },
      { blockedFiles: [{ file: "b.ts", heldBy: "card_other", heldScope: null, holderLabel: null, expiresAt: 2_000 }] },
    ],
    (id) => `name of ${id}`,
  );
  assert.deepEqual(mixed.files, ["a.ts", "b.ts"], "every file the card waits on is listed");
  assert.deepEqual(mixed.holders, ["card_other"], "only foreign holders are linkable");
  assert.equal(mixed.internal, false, "a foreign holder makes it a cross-card wait");
  assert.match(lockWaitCopy(mixed), /name of card_other/, "and the lead holder is the actionable one");
});

test("a blocked card is named as waiting, not as stalled", () => {
  const wait = blockedFileWait([{ blockedFiles: [{ file: "src/foo.ts", heldBy: "card_holder", expiresAt: 0 }] }], () => "Restore cards");
  const hero = lockWaitHero(wait);
  assert.equal(hero.kind, "paused", "it is still a paused card, with the reason attached");
  assert.match(hero.title, /waiting on a file/i);
  assert.match(hero.sub, /src\/foo\.ts/, "the sentence names the file");
  assert.match(hero.sub, /Restore cards/, "and the holder, by the name the caller resolved");
  assert.match(hero.sub, /no action needed/, "release is automatic; implying homework trains distrust");
  assert.equal(lockWaitHero(null), null, "a free card falls through to the generic idle branch");
  // A real lease carries the backstop, which the Inbox's own sentence promises;
  // an expiresAt of 0 is a lapsed/absent one and must not print a 1970 date.
  const leased = lockWaitHero(blockedFileWait(
    [{ blockedFiles: [{ file: "src/foo.ts", heldBy: "card_holder", expiresAt: Date.UTC(2026, 8, 28, 12) }] }],
    () => "Restore cards",
  ));
  assert.match(leased.sub, /at the latest/, "a live lease is stated as the backstop");
  assert.doesNotMatch(leased.sub, /1970/, "an absent lease never prints an epoch date");
  const many = lockWaitHero(blockedFileWait([
    { blockedFiles: [{ file: "a.ts", heldBy: "c1", expiresAt: 0 }] },
    { blockedFiles: [{ file: "b.ts", heldBy: "c2", expiresAt: 0 }] },
  ], (id) => id));
  assert.match(many.sub, /2 files/, "several files are counted, not listed as a wall of paths");
  assert.match(many.sub, /2 other cards/, "and several holders are counted too, rather than blaming one");
});

test("a scope says WHICH files, and a fault looks like a fault", () => {
  // The regression this pins: "files claimed" and "no live file claim" shipped
  // in the same muted paragraph, a dot apart, so a defect read as a footnote.
  const held = scopeClaimLines({ claimFiles: ["src/a.ts", "src/b.ts"], blockedFiles: [], claimed: true, status: "in-progress" });
  assert.deepEqual(held.map((row) => row.tone), ["held"], "holding files is one quiet line");
  assert.match(held[0].text, /2 files: src\/a\.ts, src\/b\.ts/, "and it names them");
  assert.equal(held[0].title, "src/a.ts · src/b.ts", "the full list survives in the tooltip, not the sentence");

  const many = scopeClaimLines({ claimFiles: ["a", "b", "c", "d"], claimed: true, status: "done" });
  assert.match(many[0].text, /\+1 more/, "a long list truncates rather than pushing the task list off the card");
  assert.equal(many[0].title, "a · b · c · d", "and truncation never loses the names");

  const blocked = scopeClaimLines({
    claimFiles: ["src/mine.ts"],
    blockedFiles: [{ file: "src/theirs.ts", heldBy: "card_holder" }],
    claimed: true,
    status: "in-progress",
  });
  assert.deepEqual(blocked.map((row) => row.tone), ["held", "blocked"], "holding your own file and waiting on another are two different facts");
  assert.match(blocked[1].text, /src\/theirs\.ts/, "the blocked line names the file");
  assert.match(blocked[1].title, /card_holder/, "and the holder's id, which is the link target");

  const missing = scopeClaimLines({ claimFiles: [], blockedFiles: [], claimed: false, status: "in-progress" });
  assert.deepEqual(missing.map((row) => row.tone), ["missing"], "running with no claim is a fault, so it says so");
  // A scope with no state dir has `claimed: null`. Absence of a state to read
  // is not the same as holding nothing, so it must never become a fault.
  assert.deepEqual(
    scopeClaimLines({ claimFiles: [], blockedFiles: [], claimed: null, status: "in-progress" }),
    [],
    "an unknown claim is silence, never an accusation",
  );
  assert.deepEqual(scopeClaimLines({ claimed: false, status: "done" }), [], "a finished scope does not need a lease to have finished");
  assert.deepEqual(scopeClaimLines(null), [], "junk rows nothing");
});
