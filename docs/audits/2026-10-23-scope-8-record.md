# SCOPE-8 record — the declaration surface, measured

**Type:** spike measurement record (SCOPE-8 re-derivation).
**Date:** 2026-10-23
**Revision measured:** `origin/master` @ `2e9cba9d7216a46c77a1ea5d90dabfcd8769f9ba`
**Worktree:** `…/worktrees/thr_iskpj9vzyd-1/bb-plugin-stelow` (clean; branch
`spike/declaration-surface-2026-10-23` cut from that commit).
**Status:** no code changed, nothing migrated. Every experiment below was
applied to the working tree and reverted; `git status --short` was empty before
this record was written. The only commit is this record and its index line.

Toolchain: Node 22.22.2, TypeScript 5.9.3 (the `^5.7.0` range resolved by
`package-lock.json`), `npm ci --ignore-scripts` (176 packages).

**The record is a measurement, not a rule.** The gate remains the authority for
behaviour; these numbers are true on the revision above and will drift.

---

## 1. What `tests/declaration-surface.test.mjs` actually guarantees

The assertion, quoted from the file (`tests/declaration-surface.test.mjs:98`):

```js
for (const match of declared.matchAll(/export declare (?:function|const) (\w+)/g)) {
  const name = match[1];
  // Three honest ways for a declaration to be true: the module defines the
  // name, the module hands it on (`export {…}` / `export {…} from`), or the
  // module defines and exports it in one statement. Anything else is a
  // declaration describing something the module does not have.
  if (local.has(name) || exported.has(name)) continue;
  if (imported.has(name)) {
    lies.push(`${file} declares ${name}, which ${sibling} imports but does not re-export`);
    continue;
  }
  lies.push(`${file} declares ${name}, which ${sibling} does not define or export`);
}
```

…and the terminal assertion at `:115`:

```js
assert.deepEqual(lies, [], `declaration files describe modules that drifted:\n  ${lies.join("\n  ")}`);
```

The regex captures `(\w+)` — a **name** — and stops there. Every list it builds
is a list of names, so the assertion can only be a statement about names. No
parameter list, arity, type or return value is read anywhere in the file.

Measured coverage on this revision:

| Measure | Value |
|---|---|
| declaration files (`.d.mts` in `lib/`) | 263 |
| files where the check runs on at least one name | 209 |
| files where it runs on zero names | 54 |
| names matched and checked | 1069 |
| `export function …` (ambient form, no `declare`) — invisible to the regex | 250 |
| `export type` declarations — never checked | 118 |
| `export interface` declarations — never checked | 184 |
| the test's own docstring: "190 declaration files and 718 declared names" | stale: 263 files, 1069 names |

That last row is itself evidence of the failure mode: prose next to a gate
drifts, and this one drifted by 73 files and 351 names with every gate green.

**The completeness direction is unguarded too.** The test checks declarations
against modules, never modules against declarations. Adding an export with no
declaration leaves it green:

```console
$ printf '\nexport function scope8ProbeUndeclared() {\n  return 1;\n}\n' >> lib/card-naming.mjs
$ node tests/declaration-surface.test.mjs
declaration surface test ok: 263 files, no orphan declaration
$ echo $?
0
```

So the guarantee is: *no declaration names a `function`/`const` the module
neither binds nor re-exports.* Nothing about signatures, coverage, types, or
whether the module still behaves as declared.

---

## 2. What happens when a `.d.mts` drifts from its `.mjs`

Canonical experiment (§2 as asked): change one declaration's **signature**, keep
the name, run both gates exactly as specified.

```console
$ sed -i 's/): boolean;/): string;/' lib/card-naming.d.mts
$ cat lib/card-naming.d.mts
export declare function needsNaming(input?: { displayName?: string | null; name?: string | null; prompt?: string | null }): string;
$ npm run --silent typecheck
$ echo "EXIT_TYPECHECK=$?"
EXIT_TYPECHECK=0
$ node tests/declaration-surface.test.mjs
declaration surface test ok: 263 files, no orphan declaration
$ echo "EXIT_DECLARATION_SURFACE=$?"
EXIT_DECLARATION_SURFACE=0
```

Both gates pass while the declaration claims `string` for a function that
returns `boolean`. Supporting variants (all reverted, same compiler invocation):

| # | Drift | `typecheck` exit | `declaration-surface` exit |
|---|---|---|---|
| A | `.d.mts` return `boolean` → `string` (canonical above) | **0** | **0** |
| B | `.d.mts` param widened `string` → `string \| number` | **0** | **0** |
| C | `.d.mts` gains a required second parameter | 2 | **0** |
| D | `.mjs` implementation gains required `mode` and can return `"no"`; declaration untouched | **0** | **0** |
| E | `.d.mts` removed for a module imported from TS | 2 | n/a (file absent) |
| F | generated `.d.mts` substituted for `bulk-eligibility` | **0** | **0** |
| G | undeclared export added to `.mjs` | n/a | **0** |

C's exit 2 is not a declaration-versus-implementation check: it is a
declaration-shape error plus two callers failing to compile:

```console
lib/card-naming.d.mts(1,124): error TS1016: A required parameter cannot follow an optional parameter.
server/runtime/card-mutations.ts(226,17): error TS2554: Expected 2 arguments, but got 1.
server/workers.ts(179,10): error TS2554: Expected 2 arguments, but got 1.
```

D is the audit's original failure mode and it is invisible end to end. E shows a
*missing* declaration is loud (`TS7016`, twice):

```console
server/runtime/card-mutations.ts(5,29): error TS7016: Could not find a declaration file for module '../../lib/card-naming.mjs'. '…/lib/card-naming.mjs' implicitly has an 'any' type.
server/workers.ts(4,29): error TS7016: Could not find a declaration file for module '../lib/card-naming.mjs'. '…/lib/card-naming.mjs' implicitly has an 'any' type.
```

The structural reason D and A/B are green:

```console
$ node_modules/.bin/tsc --noEmit --listFiles > /tmp/scope8-listfiles.txt
exit=0
$ grep -c "lib/.*\.d\.mts$" /tmp/scope8-listfiles.txt
263
$ grep -c "lib/.*\.mjs$" /tmp/scope8-listfiles.txt
0
```

All 263 declarations are in the TypeScript program; **zero** `lib/*.mjs` files
are. TypeScript never opens the file the declaration describes. The declaration
is not a checked claim — it is the only thing `tsc` knows.

---

## 3. Is the hand-written surface load-bearing?

Import census (resolving every `.mjs` specifier from a TypeScript file to a path
under `lib/`; `from` and dynamic `import()` forms, no `@/lib` aliases exist):

| Measure | Value |
|---|---|
| TypeScript files under `server/` | 273 |
| `server/` files importing at least one `lib/*.mjs` | 191 |
| distinct `lib` modules imported from `server/` | 179 |
| of those, modules with a sibling `.d.mts` | **179 (100%)** |
| modules imported from TS with **no** declaration | **0** |
| implicit-`any` sites from undeclared lib modules | **0** |
| distinct `lib` modules imported across `server/`, `components/`, `hooks/`, `server.ts`, `app.tsx` (504 files) | 231, all declared |

So the surface is load-bearing, and it is currently complete for its consumers:
a missing declaration would be a typecheck failure (E), not a silent `any`, and
none is missing. 13 `lib/*.mjs` have no `.d.mts`
(`ask-shape`, `bulk-batch`, `inbox-rescore`, `optimize-stop`, `pin-provenance`,
`prompt-budget`, `question-progress`, `question-single-pick`,
`release-major-claim`, `release-published`, `review-excerpt`, `transition-facts`,
`worktree-reclaim-policy`); none of them is imported from a TypeScript file in
the program, so they cost nothing today.

The type-only part of the surface is what consumers reach for by name:

| Measure | Value |
|---|---|
| `import type {…} from "…lib/*.mjs"` statements | 68 |
| files containing one | 54 |
| distinct modules | 28 |
| distinct type names imported | 41 |

---

## 4. Cost of the status quo, and what generation would produce

### The hand-written corpus

| Measure | Value |
|---|---|
| declaration files | 263 |
| lines (`wc -l`) | **6013** (mean 22.9, max 127) |
| size distribution | 1 line: 7 · 2–5: 49 · 6–20: 92 · 21–50: 94 · >50: 21 |
| `export` statements | 1679 |
| files containing no `any` | 243 of 263 |
| `any` occurrences | 84 in 20 files |
| `.mjs` files carrying any JSDoc type tag | **36 of 276** (`@param` 33, `@returns` 29) |
| commits in the last 90 days touching a `lib/*.mjs` and/or `lib/*.d.mts` | 353 |
| of those, touching **both** | **292 (82.7%)** |

The last two rows are the maintenance cost in one line: the pair is edited in
lockstep, by hand, roughly three commits a day. Nothing checks that the two
edits agree.

### Generation experiment

Three modules, one `tsc` run (`--allowJs --declaration --emitDeclarationOnly`,
`strict`, `rootDir lib`, `exit 0`), then `diff -u` against the hand-written
file. Selection: small (`card-naming`, 19 `.mjs` lines), medium
(`question-contracts`, 152), generics (`bulk-eligibility`, 32 — generic
`partitionByEligibility<T>` and a named `BulkEligibility` type).

| Module | hand lines | generated lines | diff lines | changed lines | byte-identical |
|---|---|---|---|---|---|
| `card-naming` | 1 | 1 | 5 | 2 | **no** |
| `question-contracts` | 33 | 52 | 87 | 81 | **no** |
| `bulk-eligibility` | 19 | 28 | 48 | 41 | **no** |

**0 of 3 reproduced byte-for-byte.** The generated files are not shorter because
they are better — they copy JSDoc comments and emit `any`:

```text
--- lib/card-naming.d.mts (hand-written)
+++ generated/card-naming.d.mts (tsc)
@@ -1 +1 @@
-export declare function needsNaming(input?: { displayName?: string | null; name?: string | null; prompt?: string | null }): boolean;
+export function needsNaming(input: any): boolean;
```

```text
--- lib/question-contracts.d.mts (hand-written)
+++ generated/question-contracts.d.mts (tsc)
@@ -1,33 +1,52 @@
-export type QuestionContract = {
-  stage: string;
-  id: string;
-  kind: "human-ask" | "agent-receipt" | "skip";
-  modes: string[];
-  /** @deprecated Use exploration_min_count. Kept for old catalogs. */
-  appetite?: string[];
-  exploration_min_count?: number;
-  evidence?: string;
-  receipt: string;
+export function loadQuestionContracts(): any;
+/**
+ * The checklist that must be satisfied before leaving a completed stage.
+ * Unknown stages, modes, and breadths fail open, matching stage-skips.
+ * `reviewMode` accepts a legacy ladder string (matched against the
+ * contract's `modes`, as before) or an explicit gate-atom array
+ * (resolved per gate — the set path).
+ * `explorationCount` gates breadth-scaled picks (a legacy `appetite`
+ * ladder string is mapped once to its breadth).
+ */
+export function requiredForStage({ stage, reviewMode, appetite, explorationCount, kind }?: {}): any;
+/** The generated catalog is the only runtime source for question contracts. */
+/**
+ * Ask-to-contract linkage for provenance. A worker may declare which
+ * question contract an ask answers (`--contract <id>` per --question
+ * group); when the human answers, the matching declaration is consumed and
+ * the trail names the contract. Pure DB helpers (no BB host dependency),
+ * following the worker-ledger precedent.
+ *
+ * Matching is by normalized question text, not interaction id: the host
+ * interaction service returns no synchronous id at ask time, and the
+ * duplicate guard serializes asks per card (at most one open set), so an
+ * earliest-unconsumed text match is exact in practice. Re-asking identical
+ * text with a different contract is already banned worker discipline.
+ * Nothing here enforces advance acceptance — undeclared flows behave
+ * byte-identically to before.
+ */
+/** Canonical form shared by writers and matchers. */
+export function normalizeQuestionText(text: any): string;
+/**
+ * Validate declared contract ids against the stage checklist (from
+ * requiredForStage, or null when unreadable). Unknown ids with a readable
+ * checklist refuse, naming the valid ids; without one the ask records raw
+ * (fail-open — a stale mirror must never deadlock a worker).
+ */
+export function validateAskContracts(declarations: any, checklist: any): {
+    ok: boolean;
+    error: null;
+} | {
+    ok: boolean;
+    error: string;
 };
-
-export function requiredForStage(input?: { stage?: string; reviewMode?: string | string[]; appetite?: string; explorationCount?: number; kind?: QuestionContract["kind"] }): Array<Pick<QuestionContract, "id" | "kind" | "receipt">>;
-
-/* merged from lib/ask-contracts.d.mts */
-type RunResult = { changes: number };
-type Db = {
-  prepare(query: string): {
-    run(...values: unknown[]): RunResult;
-    get(...values: unknown[]): any;
-  };
-  transaction(fn: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown;
-};
-export declare function normalizeQuestionText(text: unknown): string;
-export declare function validateAskContracts(
-  declarations: Array<{ contractId?: unknown } | null> | null | undefined,
-  checklist: Array<{ id?: unknown; kind?: unknown } | null> | null | undefined,
-): { ok: boolean; error: string | null };
-export declare function recordAskContracts(
-  db: Db,
-  rows: Array<{ id?: unknown; cardId?: unknown; question?: unknown; contractId?: unknown; askedAt?: unknown } | null> | null | undefined,
-): number;
-export declare function consumeAskContract(db: Db, cardId: string, questionText: unknown, consumedAt?: number): string | null;
+/** Persist declarations ({ id, cardId, question, contractId, askedAt }). */
+export function recordAskContracts(db: any, rows: any): number;
+/**
+ * Consume the earliest unconsumed declaration matching the answered
+ * question text. Returns the contract id, or null when nothing matches
+ * (normal path for undeclared asks — no behavior change there).
+ */
+export function consumeAskContract(db: any, cardId: any, questionText: any, consumedAt?: number): any;
+/** Closed vocabulary shared by the upstream contract and host enforcement. */
+export const QUESTION_KINDS: string[];
```

```text
--- lib/bulk-eligibility.d.mts (hand-written)
+++ generated/bulk-eligibility.d.mts (tsc)
@@ -1,19 +1,28 @@
-export type BulkEligibility = {
-  ok: boolean;
-  reason: string | null;
+export function canBulkStart(card: any): {
+    ok: boolean;
+    reason: string;
+} | {
+    ok: boolean;
+    reason: null;
 };
-
-export declare function canBulkStart(card: unknown): BulkEligibility;
-export declare function canBulkArchive(card: unknown): BulkEligibility;
-export declare function canBulkDelete(card: unknown): BulkEligibility;
-
-// Generic over the caller's card shape: eligibility never inspects more than
-// it returns, so the partition keeps the input type instead of widening it
-// to unknown and forcing every consumer to cast it back.
-export declare function partitionByEligibility<T>(
-  cards: T[],
-  predicate: (card: T) => BulkEligibility,
-): {
-  eligible: T[];
-  skipped: Array<{ card: T; reason: string | null }>;
+export function canBulkArchive(card: any): {
+    ok: boolean;
+    reason: string;
+} | {
+    ok: boolean;
+    reason: null;
+};
+export function canBulkDelete(card: any): {
+    ok: boolean;
+    reason: string;
+} | {
+    ok: boolean;
+    reason: null;
+};
+export function partitionByEligibility(cards: any, predicate: any): {
+    eligible: any[];
+    skipped: {
+        card: any;
+        reason: any;
+    }[];
 };
```

What is lost in each case is the part the declarations exist for: the input
shape in `card-naming`, the `QuestionContract` type and the precise return of
`requiredForStage`, the `BulkEligibility` alias and the generic type parameter.

Scaling that to the modules TS consumers import types from (the 28 modules,
41 type names above): a generation run over those 28 modules emitted 32 files,
and of the 41 imported type names **4 survive, 37 disappear** (three come from
JSDoc `@typedef`s; the fourth, `ExecutionAdapter`, is a real `export class`).
Substituting one generated file —
`execution-run-ledger` — into the tree:

```console
$ npm run --silent typecheck ; echo "EXIT_TYPECHECK=$?"
EXIT_TYPECHECK=2
# 13 × TS2724 "has no exported member named 'ExecutionRun'" + 5 × TS7006 implicit any
$ node tests/declaration-surface.test.mjs ; echo "EXIT_DECLARATION_SURFACE=$?"
declaration surface test ok: 263 files, no orphan declaration
EXIT_DECLARATION_SURFACE=0
```

Generation breaks the typecheck, not the declaration test. The typecheck fails
on the *types the `.mjs` never carried* — the alias existed only in the
hand-written file.

---

## 5. Contradiction with the premise recheck

The recheck (`2026-10-23-premise-recheck.md`, §2, scope 8) says:

> generation is not a live third option (generated output would break the
> `.mjs` binding the surface test requires)

That is **not** what the measurement shows. Measurement F substituted a
generated `.d.mts` for `lib/bulk-eligibility.d.mts`:

```console
$ cp /tmp/scope8-gen/out/bulk-eligibility.d.mts lib/bulk-eligibility.d.mts
$ node tests/declaration-surface.test.mjs ; echo $?
declaration surface test ok: 263 files, no orphan declaration
0
$ npm run --silent typecheck ; echo $?
0
```

The same substitution for `execution-run-ledger` also leaves the surface test at
exit 0. The test requires no `export declare` binding at all: it checks the
names that appear in that form, and generated output uses `export function`, so
on a generated file it checks **zero** names. Generation is live with respect to
that test. What blocks migration is type fidelity and the 37/41 imported type
names — a different obstacle, with a different cost.

The recheck's other three corrections hold: `types/` does not exist, the counts
are 263/276, and the option space needed re-derivation.

---

## 6. Verdict

**Keep the hand-written declarations.** Migrate nothing in this scope.

Four numbers decide it:

1. **0 of 3** sampled declarations are reproducible by `tsc --declaration`; the
   generated set loses the types (`input: any`, no `QuestionContract`, generic
   `T` → `any`).
2. **37 of 41** type names imported by TypeScript exist only in the
   hand-written files; a generated surface fails typecheck with 18 errors on
   one module alone.
3. **36 of 276** `.mjs` files carry JSDoc type tags — the input generation would
   need — while **243 of 263** declarations are `any`-free. The precision lives
   on one side of the pair only.
4. **6013** hand-maintained lines, and **292 of 353** commits in 90 days touch
   both the module and its declaration. The cost is real; it is the price of
   the precision in (3).

**For migration to become the better option, one thing must become true:** every
exported symbol in every `.mjs` carries JSDoc (`@param`, `@returns`, `@typedef`)
rich enough that `tsc --declaration` reproduces the hand-written type — i.e.
coverage must grow from 36/276 files to effective 276/276, and the 41 imported
type names must survive verbatim. Without that, migration is a type regression
dressed as a deletion.

**Risks.**

- *Keep:* there is no signature-level guard at all (A, B and D are green), so a
  declaration can lie and consumers compile against the fiction; 6013 lines are
  maintained by hand in 82.7% lockstep. The mitigation is a signature/integrity
  check — a new scope, not this spike.
- *Migrate now:* precision collapses to `any` wherever JSDoc is missing, 37
  imported type names break, and the declaration test stops checking generated
  files by construction (it only sees `export declare`). The blast radius is the
  plugin's public type surface.

**Decisions a human must make, not an agent:** whether any breaking type change
is acceptable at all, and therefore which release line/version bump a
declaration migration would require (release-please types: `feat` is a minor,
a `BREAKING CHANGE:` footer a major); and whether a signature-integrity check is
accepted as its own scope, given SCOPE-7/8 are already one unit of work
(pruning a `.mjs` export reddens the surface test until the `.d.mts` goes with
it).

---

## Appendix — commands

All run from the worktree root; every mutation was reverted.

```console
npm ci --ignore-scripts --no-audit --no-fund
node_modules/.bin/tsc --version                 # 5.9.3
node_modules/.bin/tsc --noEmit                  # baseline, exit 0
node tests/declaration-surface.test.mjs         # baseline, exit 0, 263 files
node_modules/.bin/tsc --noEmit --listFiles      # 263 .d.mts, 0 lib/*.mjs

# §2 drift (canonical)
sed -i 's/): boolean;/): string;/' lib/card-naming.d.mts
npm run --silent typecheck                      # exit 0
node tests/declaration-surface.test.mjs         # exit 0

# §4 generation
node_modules/.bin/tsc -p /tmp/scope8-gen/tsconfig.json   # exit 0
diff -u lib/<module>.d.mts /tmp/scope8-gen/out/<module>.d.mts
```

The `/tmp` logs (`scope8-tc-*.log`, `scope8-listfiles.txt`, generated trees) are
host-local and not committed; every decisive line is quoted above.
