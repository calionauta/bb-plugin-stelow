import assert from "node:assert/strict";
import { cardFileOccupancy, fileOccupancy, fileOccupancyLine } from "../lib/file-occupancy.mjs";

const NOW = 1_000_000;

// The shape `liveClaimsForWorkspace` returns, so the fixture is the query's
// real output rather than a convenient invention.
const rows = [
  { workspace_path: "/repo", file_path: "src/a.ts", card_id: "card_1", scope: "S1", expires_at: NOW + 60_000, fencing: 1 },
  { workspace_path: "/repo", file_path: "src/a.ts", card_id: "card_2", scope: "S9", expires_at: NOW + 60_000, fencing: 1 },
  { workspace_path: "/repo", file_path: "src/b.ts", card_id: "card_2", scope: "S10", expires_at: NOW - 1, fencing: 1 },
];

// The case that motivated this: before the collision, not after it.
{
  const answer = cardFileOccupancy(rows, { cardId: "card_1", workspacePath: "/repo", nowMs: NOW });
  // Two files carry another card's claim, so both are shared: src/a.ts live,
  // src/b.ts lapsed. Both are shown, and only the second is named as lapsed.
  assert.equal(answer.shared, 2, "both files carrying another card's claim are shown");
  assert.equal(
    answer.lines[0],
    `src/a.ts is also held by card "S9" until ${new Date(NOW + 60_000).toLocaleString()}`,
    "the live line names the file, the holding scope, and when the lease ends",
  );
  assert.match(answer.lines[1], /^src\/b\.ts/, "the lapsed one is shown too — the state is not hidden");
  assert.match(answer.lines[1], /lapsed/, "and named as lapsed, because nothing holds it now");
}

// A file only this card holds is not a shared file, and saying so would be
// noise on every row of every card.
{
  const alone = cardFileOccupancy([rows[1]], { cardId: "card_2", nowMs: NOW });
  assert.equal(alone.shared, 0, "your own files are not reported back to you");
  assert.deepEqual(alone.lines, [], "so the disclosure can stay closed");
}

// A file with two holders is a list, not a winner — that is the case worth
// seeing, and it is why the shape keeps every holder.
{
  const both = fileOccupancy([rows[0], rows[1]], { nowMs: NOW });
  assert.equal(both[0].holders.length, 2, "a file with two holders is a list, not a winner");
  assert.deepEqual(
    both[0].holders.map((holder) => holder.cardId),
    ["card_1", "card_2"],
    "and both are named",
  );
}

// The same card twice for one file is one holder through two leases.
{
  const twice = fileOccupancy([rows[0], { ...rows[0], scope: "S1" }], { nowMs: NOW });
  assert.equal(twice[0].holders.length, 1, "one card holding one file is one holder");
  assert.equal(
    fileOccupancy([rows[0], { ...rows[0], scope: "S2" }], { nowMs: NOW })[0].holders.length,
    2,
    "but two scopes of the same card are two claims worth seeing",
  );
}

// Isolation replaces exclusion. A managed worktree is unreachable by other
// cards by construction, so a scan there can only ever return "nobody" and an
// empty disclosure is the honest answer — not a silent one.
{
  const isolated = cardFileOccupancy(rows, { cardId: "card_1", isolated: true, nowMs: NOW });
  assert.equal(isolated.isolated, true, "the caller is told WHY there is nothing to show");
  assert.equal(isolated.shared, 0);
  assert.deepEqual(isolated.lines, []);
}

// Malformed rows are skipped rather than rendered: a row with no file is not a
// file, and a holder with no card id is not a holder.
{
  const junk = cardFileOccupancy([
    { file_path: "", card_id: "card_1" },
    { file_path: "src/c.ts" },
    { file_path: "src/d.ts", card_id: "card_3" },
    null,
    "nonsense",
  ], { cardId: "card_1", nowMs: NOW });
  assert.equal(junk.shared, 1, "only the one real holder survives");
  assert.match(junk.lines[0], /^src\/d\.ts/, "and it is the real one");
}

assert.equal(fileOccupancyLine({ file: "x.ts", holders: [] }), null, "no holders is no line");

console.log("file occupancy test ok: who else holds this card's files, before any collision");
