import assert from "node:assert/strict";

import { auditTree, summarize } from "../scripts/audit-declarations.mjs";

/**
 * The declaration surface has a second half nobody tested.
 *
 * `declaration-surface.test.mjs` binds NAMES, of `export declare` only. The spike
 * in `docs/audits/2026-10-23-scope-8-record.md` measured the rest: 250
 * `export function`s in `.mjs` files are invisible to it, 118 types and 184
 * interfaces are never checked, and `tsc --listFiles` shows 0 `lib/*.mjs` in the
 * program — the implementation is never compiled, so the declaration IS the type
 * surface. A declaration may therefore lie about a signature while every gate
 * stays green.
 *
 * Two kinds are absolute, because both are lies a caller pays for:
 *   ARITY        the declaration promises a different number of parameters than
 *                the implementation takes. Found 2 on the first run, both real:
 *                `previewFileSample` and `isRecipeTaskActive` each accepted a
 *                third argument the declaration denied (`discard-policy.mjs:122`
 *                passes one from inside the module).
 *   ORPHAN-DECL  the declaration promises a name the implementation does not
 *                export.
 *
 * Two kinds are a ratchet, because they describe debt that is real but not yet
 * paid:
 *   ORPHAN-EXPORT  implemented and exported, absent from the declaration — a
 *                  TypeScript caller cannot see it.
 *   UNCHECKED      a barrel re-export, where the shape cannot be compared
 *                  locally; the audit refuses to guess rather than reporting a
 *                  false arity.
 *
 * Lowering a number is progress. Raising one needs a reason in the commit that
 * raises it — and the reason cannot be "the new export is fine".
 */
const BASELINE = Object.freeze({ "ORPHAN-EXPORT": 42, UNCHECKED: 35 });

const { pairs, findings } = auditTree(new URL("../lib", import.meta.url).pathname);
const counts = summarize(findings);

assert.ok(pairs > 200, `the audit found the module pairs (${pairs})`);
assert.equal(counts.ARITY ?? 0, 0, `no declaration disagrees with its implementation: ${counts.ARITY ?? 0}`);
assert.equal(
  counts["ORPHAN-DECL"] ?? 0,
  0,
  `no declaration promises a name that does not exist: ${counts["ORPHAN-DECL"] ?? 0}`,
);

for (const [kind, ceiling] of Object.entries(BASELINE)) {
  const actual = counts[kind] ?? 0;
  assert.ok(
    actual <= ceiling,
    `${kind} only shrinks: ${actual} > baseline ${ceiling}. Lower the baseline if this is progress; raising it needs a reason.`,
  );
}

console.log(
  `declaration drift ok: ${pairs} pairs, arity 0, ` +
    `${counts["ORPHAN-EXPORT"] ?? 0} invisible exports (ceiling ${BASELINE["ORPHAN-EXPORT"]}), ` +
    `${counts.UNCHECKED ?? 0} unchecked (ceiling ${BASELINE.UNCHECKED})`,
);
