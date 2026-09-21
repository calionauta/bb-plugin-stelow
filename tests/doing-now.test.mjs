import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { doingNowNames, dominantScopeName } from "../lib/doing-now.mjs";

const scopes = [
  { id: "s1", name: "Checkout", status: "done", tasks: [{ name: "t1", status: "done" }] },
  { id: "s2", name: "Apple Pay", status: "in-progress", tasks: [{ name: "t2", status: "in-progress" }, { name: "t3", status: "pending" }] },
  { id: "s3", name: "Refunds", status: "pending", tasks: [{ name: "t4", status: "in-progress" }, { name: "t5", status: "pending" }] },
];

// In-progress scopes first (state order), then orphan in-progress tasks.
// Done scopes never surface; tasks inside a doing scope ride with it.
assert.deepEqual(doingNowNames(scopes), ["Apple Pay", "t4"], "doing scopes first, orphan tasks after, done silent");
assert.deepEqual(doingNowNames([{ name: "A", status: "done", tasks: [] }]), [], "all-done resolves empty, never history");
assert.deepEqual(doingNowNames(null), [], "junk resolves empty, never throws");
assert.deepEqual(doingNowNames(scopes, 1), ["Apple Pay"], "the limit caps callers that only fit one name");
assert.equal(dominantScopeName(scopes), "Apple Pay", "the executing scope headlines");
assert.equal(
  dominantScopeName([
    { name: "A", status: "pending", tasks: [{ name: "t1", status: "pending" }] },
    { name: "B", status: "pending", tasks: [{ name: "t1", status: "pending" }, { name: "t2", status: "pending" }, { name: "t3", status: "pending" }] },
  ]),
  "B",
  "without execution the largest open scope headlines",
);
assert.equal(dominantScopeName([{ name: "A", status: "done", tasks: [] }]), null, "finished scopes never headline");
assert.equal(dominantScopeName(null), null, "junk headlines nothing");

// Server carries doing names on the list payload (one parse, cached with
// the summary): tiles and rows read names, never re-derive them.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");
const app = readFileSync(join(root, "app.tsx"), "utf8");
assert.match(server, /doingNow: z\.array\(z\.string\(\)\)/, "list cards contract the doing names");
assert.match(server, /doingNow: doingNowNames\(scopes\)/, "the cached summary computes names once per card");
assert.match(server, /doingNow: summary\.doingNow/, "list rows carry the cached names");

// One shared pill on tiles and rows, live execution only: idle cards show
// no pill (paused speaks for itself), and empty sets render nothing.
assert.match(app, /<DoingNowPill names=\{card\.doingNow \?\? \[\]\} \/>/, "tiles name the executing scope");
assert.match(app, /\(card\.activity === "running" \|\| card\.activity === "awaiting-answer"\)/, "the pill marks live execution, never idle");

console.log("doing now test ok: shared selection, dominant headline, done silent");
