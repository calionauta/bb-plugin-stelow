import assert from "node:assert/strict";
import {
  MAX_REWORK_ROUNDS,
  nextReworkRounds,
  reworkCapReached,
  reworkCapRefusal,
  reworkRoundsOf,
} from "../lib/rework-rounds.mjs";

// The round budget is a leash, not a quality signal: front-loaded gains mean
// 3 revision cycles is the documented default (gauntlet-mini), with early
// stop on pass and honest stop on no-progress — never a fixed count as proof.
assert.equal(MAX_REWORK_ROUNDS, 3, "three revision cycles before the honest stop");

// Counter reads: missing or malformed state never blocks, it just starts over.
assert.equal(reworkRoundsOf(null), 0, "no entry reads as zero rounds");
assert.equal(reworkRoundsOf({}), 0, "no column reads as zero rounds");
assert.equal(reworkRoundsOf({ rework_rounds: 2 }), 2, "stored rounds are honored");
assert.equal(reworkRoundsOf({ rework_rounds: "2" }), 2, "stringified counts are tolerated");
assert.equal(reworkRoundsOf({ rework_rounds: "nope" }), 0, "garbage reads as zero, never NaN");

// Cap boundary: the third creation spends the last unit, the fourth refuses.
assert.equal(reworkCapReached({ rework_rounds: 2 }), false, "round 3 still converts");
assert.equal(reworkCapReached({ rework_rounds: 3 }), true, "round 4 refuses instead of growing");
assert.equal(reworkCapReached({}), false, "a fresh card never starts capped");

// Only creating work spends: idempotent re-runs and linked gaps cost nothing.
assert.equal(nextReworkRounds({ rework_rounds: 2 }, 1), 3, "creating scopes spends one round");
assert.equal(nextReworkRounds({ rework_rounds: 2 }, 0), 2, "creating nothing spends nothing");
assert.equal(nextReworkRounds({}, 2), 1, "the first creation counts one");

// The refusal is a rollback with doors, not a park: it names the budget, the
// unscoped gaps, and exactly the three exits that already exist — inline fix,
// skipped scope (resolved at done), and split. A refusal without an exit is a
// deadlock with a good error message.
const refusal = reworkCapRefusal(3, ["promo codes ignored", "session expiry open"]);
assert.match(refusal, /3\/3 rounds/, "the refusal names the spent budget");
assert.match(refusal, /promo codes ignored/, "the refusal lists what is still unscoped");
assert.match(refusal, /fixed/, "exit 1: resolve inline and reclassify as fixed");
assert.match(refusal, /skipped/, "exit 2: skipped scopes count as resolved");
assert.match(refusal, /bb stelow split/, "exit 3: split moves it to a new card");

console.log("rework rounds test ok: budget boundary, spend rule, refusal with three exits");
