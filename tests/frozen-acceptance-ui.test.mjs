import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rowPath = join(root, "components", "detail", "frozen-acceptance-row.tsx");
const heroPath = join(root, "components", "detail", "build-detail-hero.tsx");
const postbuildPath = join(root, "scripts", "postbuild.mjs");

/**
 * Fase 5 UI e sync espelho (red-first).
 *
 * Acceptance-tecnico congelado (test_map / freeze_sha / red_proof) e
 * Accept-humano (card-acceptance receipt) sao fatos diferentes no mesmo card.
 * Esta suite prova a separacao no codigo: a row congelada nunca importa o
 * receipt humano, e o hero carrega as duas em linhas distintas.
 */
test("frozen row exists and never imports the human receipt", () => {
  assert.ok(existsSync(rowPath), "components/detail/frozen-acceptance-row.tsx exists");
  const source = readFileSync(rowPath, "utf8");
  assert.doesNotMatch(source, /card-acceptance/, "frozen row never imports card-acceptance");
  // TEST-FIX (same intent, reachable): the frozen component is itself named
  // FrozenAcceptanceRow, so a bare /AcceptanceRow/ substring also matches its
  // own name and GREEN was unreachable. Pin the actual reuse shapes instead:
  // no import from the human module and no <AcceptanceRow JSX reuse.
  assert.doesNotMatch(source, /from\s*["']\.\/acceptance-row["']/, "frozen row never imports the human row module");
  assert.doesNotMatch(source, /<AcceptanceRow[\s>]/, "frozen row never reuses the human AcceptanceRow element");
});

test("frozen row badges red/green+lock by test_map and banners frozen-stale", () => {
  const source = readFileSync(rowPath, "utf8");
  assert.match(source, /test_map|testMap/, "badges derive from test_map");
  assert.match(source, /freeze/i, "frozen sha is referenced");
  assert.match(source, /red_proof|redProof/, "red proof is referenced");
  assert.match(source, /🔒|lock/i, "frozen state carries a lock marker, not just colour");
  assert.match(source, /frozen-stale|stale/i, "stale-freeze banner exists");
  assert.match(source, /role="note"|role="alert"/, "stale banner is exposed to assistive tech");
});

test("frozen badge helper maps test_map entries without inventing state", async () => {
  const module = await import("../components/detail/frozen-acceptance-row.mjs").catch(() => null);
  if (!module || typeof module.frozenBadgeFor !== "function") {
    const source = readFileSync(rowPath, "utf8");
    assert.match(
      source,
      /export function frozenBadgeFor/,
      "pure frozenBadgeFor helper is exported for the badge mapping",
    );
    return;
  }
  assert.equal(module.frozenBadgeFor(null)?.tone, "missing");
  assert.equal(module.frozenBadgeFor({ test: "x", frozen: false })?.tone, "missing");
  assert.equal(module.frozenBadgeFor({ test: "x", frozen: true, redProof: "fail" })?.tone, "red");
  const green = module.frozenBadgeFor({ test: "x", frozen: true, redProof: "pass" });
  assert.equal(green?.tone, "green");
  assert.match(String(green?.glyph ?? green?.label ?? ""), /🔒|lock/i);
});

test("frozen badge helper maps structured red_proof without inventing state", async () => {
  const module = await import("../components/detail/frozen-acceptance-row.mjs");
  assert.equal(typeof module.frozenBadgeFor, "function");
  // red_proof estruturado {failed_command, exit_code, output_excerpt}:
  // exit_code != 0 prova o FAIL (red), exit_code 0 prova o PASS (green+lock).
  const red = module.frozenBadgeFor({
    test: "node --test tests/frozen-acceptance-ui.test.mjs",
    frozen: true,
    redProof: { failed_command: "node --test tests/frozen-acceptance-ui.test.mjs", exit_code: 1, output_excerpt: "not ok" },
  });
  assert.equal(red?.tone, "red");
  const green = module.frozenBadgeFor({
    test: "node --test tests/frozen-acceptance-ui.test.mjs",
    frozen: true,
    redProof: { failed_command: "node --test tests/frozen-acceptance-ui.test.mjs", exit_code: 0, output_excerpt: "ok" },
  });
  assert.equal(green?.tone, "green");
  assert.match(String(green?.glyph ?? green?.label ?? ""), /🔒|lock/i);
  // Sem red_proof continua missing — ausencia de freeze nunca e red.
  assert.equal(module.frozenBadgeFor({ test: "x", frozen: true, redProof: null })?.tone, "missing");
  assert.equal(typeof module.isFrozenStale, "function");
  assert.equal(module.isFrozenStale({ freezeSha: "abc123", currentHeadSha: "abc123" }), false);
  assert.equal(module.isFrozenStale({ freezeSha: "abc123", currentHeadSha: "def456" }), true);
  assert.equal(module.isFrozenStale({ freezeSha: null, currentHeadSha: "def456" }), false);
});

test("build hero renders the frozen row beside, never inside, the human receipt", () => {
  const source = readFileSync(heroPath, "utf8");
  assert.match(source, /FrozenAcceptanceRow/, "hero imports the frozen row");
  assert.match(source, /from "\.\/frozen-acceptance-row"/, "hero imports from the frozen module");
  assert.match(source, /AcceptanceRow/, "human receipt stays rendered");
});

test("postbuild proves the mirror: dist/skills grep for freeze", () => {
  const source = readFileSync(postbuildPath, "utf8");
  assert.match(source, /dist.*skills|skills.*dist/, "postbuild touches dist/skills");
  assert.match(source, /freeze/i, "postbuild greps the shipped mirror for the freeze marker");
});
