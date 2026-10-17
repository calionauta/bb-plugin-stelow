import assert from "node:assert/strict";
import { doingNowNames, orderedDoingNow } from "../lib/doing-now.mjs";

const scopes = [
  {
    id: "s1",
    name: "Checkout",
    status: "done",
    tasks: [{ name: "t1", status: "done" }],
  },
  {
    id: "s2",
    name: "Apple Pay",
    status: "in-progress",
    tasks: [
      { name: "t2", status: "in-progress" },
      { name: "t3", status: "pending" },
    ],
  },
  {
    id: "s3",
    name: "Refunds",
    status: "pending",
    tasks: [
      { name: "t4", status: "in-progress" },
      { name: "t5", status: "pending" },
    ],
  },
];

// In-progress scopes first (state order), then orphan in-progress tasks.
// Done scopes never surface; tasks inside a doing scope ride with it.
assert.deepEqual(
  doingNowNames(scopes),
  ["Apple Pay", "t4"],
  "doing scopes first, orphan tasks after, done silent",
);
assert.deepEqual(
  doingNowNames([{ name: "A", status: "done", tasks: [] }]),
  [],
  "all-done resolves empty, never history",
);
assert.deepEqual(doingNowNames(null), [], "junk resolves empty, never throws");
assert.deepEqual(
  doingNowNames(scopes, 1),
  ["Apple Pay"],
  "the limit caps callers that only fit one name",
);
assert.deepEqual(
  orderedDoingNow("Refunds", ["Apple Pay", "Refunds", "t4"]),
  ["Refunds", "Apple Pay", "t4"],
  "the executing scope is first and duplicates disappear",
);
assert.deepEqual(
  orderedDoingNow(null, ["A", "A", "B"]),
  ["A", "B"],
  "without an active scope, names are de-duplicated",
);

console.log("doing now test ok: shared selection, done silent");
