import assert from "node:assert/strict";
import { normalizePromoteName, findAdoptableProject } from "../lib/promote-card.mjs";

// Naming: trims, collapses whitespace, caps length, falls back honestly.
assert.equal(normalizePromoteName("  My  Project  ", "Fallback"), "My Project", "trims and collapses");
assert.equal(normalizePromoteName("", "Card Title Here"), "Card Title Here", "empty input falls back to card name");
assert.equal(normalizePromoteName(null, null), "Exploratory work", "nothing yields a usable default");
assert.equal(normalizePromoteName("x".repeat(200), "Fallback"), "x".repeat(120), "caps at 120 chars");

// Adoption: free names create, same-path retries adopt, foreign names conflict.
const existing = [
  { id: "p1", name: "Stelow exploratory work", sources: [{ path: "/home/u/.bb/stelow/exploratory" }] },
  { id: "p2", name: "Jogo da velha", sources: [{ path: "/home/u/.bb/stelow/exploratory/card_abc" }] },
];
assert.deepEqual(findAdoptableProject(existing, "Brand New", "/any"), { action: "create" }, "free name creates");
const adopted = findAdoptableProject(existing, "jogo DA velha", "/home/u/.bb/stelow/exploratory/card_abc");
assert.equal(adopted.action, "adopt", "same-name same-path adopts on retry");
assert.equal(adopted.project.id, "p2", "adopts the matching project");
const conflict = findAdoptableProject(existing, "Jogo da velha", "/elsewhere");
assert.equal(conflict.action, "conflict", "same-name other-path conflicts");
assert.equal(conflict.project.id, "p2", "conflict names the blocking project");
assert.deepEqual(findAdoptableProject([], "Anything", "/any"), { action: "create" }, "no projects creates");

console.log("promote card test ok: naming fallback, create/adopt/conflict");
