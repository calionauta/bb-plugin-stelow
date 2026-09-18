import assert from "node:assert/strict";
import { resolveClaimKey } from "../lib/card-claim-key.mjs";

// The registry key is the checkout the worker writes to. Keying by project
// source would falsely serialize cards isolated in their own worktrees.
assert.equal(
  resolveClaimKey({ checkoutPath: "/wt/card-a", sourcePath: "/repo" }),
  "/wt/card-a",
  "effective checkout wins over source",
);
assert.equal(
  resolveClaimKey({ checkoutPath: null, sourcePath: "/repo" }),
  "/repo",
  "source is the fallback (project-default runs there)",
);
assert.equal(
  resolveClaimKey({ checkoutPath: "  ", sourcePath: "/repo" }),
  "/repo",
  "blank checkout falls back",
);
assert.equal(resolveClaimKey({ checkoutPath: null, sourcePath: null }), null, "no path resolves to null");
assert.equal(resolveClaimKey({ checkoutPath: 42, sourcePath: null }), null, "non-strings resolve to null");

console.log("card-claim-key: ok");
