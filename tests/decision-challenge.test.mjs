import assert from "node:assert/strict";
import { isChallengeable, requiresChallenge } from "../lib/decision-challenge.mjs";

const current = { shapeVersion: "s1", scopeMapVersion: "m1" };
const live = {
  id: "r1",
  scopeIds: ["s1"],
  selectedId: "opt-5",
  rejectedOptionIds: ["opt-3"],
  authorizesVersions: { shape_version: "s1", scopeMapVersion: "m1" },
};
const legacy = { id: "r-legacy", scopeIds: ["s1"] };

// Proposing a rejected option requires a challenge naming the receipt.
const hit = requiresChallenge({ scopeIds: ["s1"], optionIds: ["opt-3"] }, [live], { challengeReceiptIds: [] });
assert.deepEqual(hit, { receiptId: "r1", reason: "proposes rejected option opt-3" });

// An open challenge naming the receipt clears the requirement.
assert.equal(
  requiresChallenge({ scopeIds: ["s1"], optionIds: ["opt-3"] }, [live], { challengeReceiptIds: ["r1"] }),
  null,
);

// Contradicting the selection inside a covered scope requires a challenge.
const contra = requiresChallenge({ scopeIds: ["s1"], selectedId: "opt-3" }, [live], { challengeReceiptIds: [] });
assert.equal(contra?.receiptId, "r1");

// A different option in unrelated scopes does not trigger.
assert.equal(requiresChallenge({ scopeIds: ["s9"], optionIds: ["opt-7"] }, [live], { challengeReceiptIds: [] }), null);

// Legacy receipts fail closed: revisiting decided scopes needs a challenge.
const legacyHit = requiresChallenge({ scopeIds: ["s1"] }, [legacy], { challengeReceiptIds: [] });
assert.equal(legacyHit?.receiptId, "r-legacy");

// Superseded or stale receipts are never challenge targets.
assert.equal(isChallengeable({ ...live, supersededBy: "r2" }, current), false);
assert.equal(
  isChallengeable(live, { shapeVersion: "s2", scopeMapVersion: "m1" }),
  false,
  "stale receipts route to reconfirmation, not challenge",
);
assert.equal(isChallengeable(live, current), true);
assert.equal(isChallengeable({ kind: "x" }, current), false);

console.log("decision-challenge: ok");
