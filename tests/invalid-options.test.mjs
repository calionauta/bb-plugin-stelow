import assert from "node:assert/strict";
import { validateInvalidOptionsStrict } from "../lib/interface-contrast.mjs";

// Strict discarded-option shape: id + reason, optional retiredBy link.
// Undefined stays valid (absent is absent); the loose receipt check is
// untouched, so old receipts keep validating.
assert.deepEqual(validateInvalidOptionsStrict(undefined), [], "absent stays absent");
assert.deepEqual(
  validateInvalidOptionsStrict([
    { id: "opt-3", reason: "simpler but drops offline scope", retiredBy: "receipt-9" },
  ]),
  [],
  "typed discard with retirement link passes",
);
assert.deepEqual(
  validateInvalidOptionsStrict([{ id: "opt-3", reason: "loses offline" }]),
  [],
  "retiredBy is optional",
);
assert.ok(
  validateInvalidOptionsStrict([{ reason: "no id" }]).some((issue) => issue.includes("requires id")),
  "missing id fails",
);
assert.ok(
  validateInvalidOptionsStrict([{ id: "opt-3" }]).some((issue) => issue.includes("requires reason")),
  "missing reason fails",
);
assert.deepEqual(
  validateInvalidOptionsStrict("opt-3"),
  ["invalidOptions must be an array"],
  "non-array fails",
);
assert.ok(
  validateInvalidOptionsStrict([{ id: "opt-3", reason: "x", retiredBy: " " }]).length > 0,
  "blank retiredBy fails",
);

console.log("invalid options test ok: strict discard shape without touching loose receipts");
