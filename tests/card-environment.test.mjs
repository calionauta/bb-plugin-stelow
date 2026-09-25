import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { selectCardEnvironment, isManagedWorktreeEnvironment, environmentFallbackNotice } from "../lib/card-environment.mjs";

// Selection is total and explicit: accepted shapes pass through by
// reference, everything else falls back — and a substituted explicit
// request produces a notice instead of vanishing (the worktree-that-never
// -was shape: asked managed-worktree, worker landed in the checkout).
const fallback = { type: "project-default" };
const worktree = { type: "host", workspace: { type: "managed-worktree", path: "/w" } };
const reuse = { type: "reuse", environmentId: "env_1" };

assert.equal(selectCardEnvironment(worktree, fallback), worktree, "explicit worktree passes by reference");
assert.equal(selectCardEnvironment({ type: "project-default" }, fallback).type, "project-default", "explicit default passes");
assert.equal(selectCardEnvironment(reuse, fallback), reuse, "reuse passes by reference");
assert.deepEqual(
  selectCardEnvironment({ type: "provider", environmentProviderId: "cloud-box", inputs: null }, fallback),
  { type: "provider", environmentProviderId: "cloud-box", inputs: null },
  "provider environments pass through instead of collapsing to the checkout",
);
assert.equal(selectCardEnvironment({ type: "provider" }, fallback), fallback, "provider without id falls back with notice");
assert.match(
  environmentFallbackNotice({ type: "provider" }, fallback) ?? "",
  /asked provider environment \(missing provider id\)/,
  "provider misses name themselves",
);
assert.equal(selectCardEnvironment({ type: "host", workspace: { type: "weird" } }, fallback), fallback, "unknown workspace falls back");
assert.equal(selectCardEnvironment({ type: "host" }, fallback), fallback, "missing workspace falls back");
assert.equal(selectCardEnvironment(null, fallback), fallback, "nothing asked falls back silent");
assert.equal(selectCardEnvironment("worktree", fallback), fallback, "junk falls back");

assert.equal(isManagedWorktreeEnvironment(worktree), true, "worktree detects");
assert.equal(isManagedWorktreeEnvironment(fallback), false, "checkout is not a worktree");
assert.equal(isManagedWorktreeEnvironment(null), false, "junk is not a worktree");

assert.equal(environmentFallbackNotice(null, fallback), null, "nothing asked means no notice");
assert.equal(environmentFallbackNotice(worktree, worktree), null, "honored requests stay silent");
assert.match(
  environmentFallbackNotice(worktree, fallback) ?? "",
  /asked host with managed-worktree workspace, using the project checkout/,
  "substitutions name asked vs used",
);
assert.match(
  environmentFallbackNotice(worktree, fallback) ?? "",
  /restart the worker/,
  "every notice names the redirect",
);
assert.match(
  environmentFallbackNotice({ type: "host", workspace: { type: "weird" } }, fallback) ?? "",
  /asked host with weird workspace/,
  "unrecognized shapes name themselves instead of vanishing",
);

// Wiring pin: creation surfaces the substitution (log plus card comment),
// shared by build/research/explore through createCardInternal.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cardCreator = readFileSync(
  join(root, "server/runtime/wiring/card-creator.ts"),
  "utf8",
);
const cardsCreate = readFileSync(join(root, "server/cards-create-persist.ts"), "utf8");
assert.match(cardsCreate, /environmentFallbackNotice\(input\.environment, prepared\.environment\)/, "creation checks the substitution");
assert.match(
  cardCreator,
  /comment:\s*\(cardId, body\)\s*=>\s*\{\s*core\.ledger\.logCardComment\(cardId, "card", cardId, "agent", body\);\s*\}\s*,?/,
  "substitutions page the card",
);

console.log("card environment test ok: explicit pass-through, honest fallback, creation notice");
