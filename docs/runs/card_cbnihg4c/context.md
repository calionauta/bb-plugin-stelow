# Context synthesis — one field, two layers, and a label that means the wrong thing

Synthesis of [`context-analysis.md`](./context-analysis.md) (method: `stelow-product-multi-method-market-analysis`,
Variant 1 — PESTLE / Foresight / Delphi / Wardley across three horizons, adjudicated against the four
decisions the request and the recon force).

Intent: `feature`. Appetite: `Complete`. Review mode: `Auto`. Product type: `software`.
This is a Context-stage input for Shape Up. It records **decisions and a sequencing plan**; it is not a
spec and starts no implementation.

Every code claim below was re-verified against the working tree in this run (2026-09-30).

---

## 1. Verdict

> **Settle the vocabulary first, then ship the control, then ship the seed — and seed only the half
> that can be seeded honestly.**

The request reads as one missing control. It is three decisions — **a vocabulary**, **a scope**, and
**a precedence order** — and the vocabulary is wrong today, before any field is added. A radio labelled
"Project checkout / Worktree" over the existing enum ships a control that is wrong for one of its two
states, in the expensive direction: on any git project, "Project checkout" produces a worktree.

The seed half is not symmetric either. Verified in the SDK this run: the `host` variant of
`CreateThreadEnvironmentArgs` takes `hostId` as **optional** and a `managed-worktree` workspace as
`{baseBranch: {kind: "default"}}` — so the worktree intent seeds cleanly, with no host the plugin does
not own. The shared-checkout intent has no such shape: `workerEnvironment` resolves it to
`{type:"host", hostId, workspace:{type:"unmanaged", path: source.path}}`, and **`source.path` is
resolved server-side, at card creation, from the project the person picked inside the composer**
(`server/cards-create.ts:249-252`). The seed cannot know it. The SDK documents the consequence itself
(*"An `unmanaged` workspace's `path` has no composer control; the seeded selection submits
`path: null`"*), and `path: null` means the host's configured checkout — not necessarily the project's
source.

## 2. What the analysis overturned

**The enum's two values are not the reader's two options.** This is the finding that reorganizes the
request, and it is verified in three places:

| Layer | Token | What it resolves to | Evidence |
|---|---|---|---|
| Stelow preset | `project-default` | `{type:"host", workspace:{type:"unmanaged", path}}` — the **shared checkout** | `server/workers.ts:99-101`, `server/preset-migrations.ts:11` (`CHECK (environment_kind IN ('project-default','new-worktree'))`) |
| Stelow preset | `new-worktree` | `{type:"project-default"}` — **delegated** to bb | `server/workers.ts:103` |
| bb server | `{type:"project-default"}` | a **managed worktree** when the source has a usable base branch | commit `893a05a` (2026-08-12), `thread-default-policy.ts` |
| What the person reads | "Project checkout" / "Worktree" | the reader's options are correct | `ISOLATED_WORKTREE_LABEL` |

So Stelow's `project-default` means "not isolated" and bb's `project-default` means "isolated whenever
git allows". `new-worktree` works *only* through that inversion — it forwards a token whose host meaning
was deliberately redefined six weeks ago, in a commit whose own summary reads *"prefer an isolated
worktree … or work in that source checkout when it does not"*. A `new-worktree` preset is thus correct
by delegation to a policy the plugin did not write, and on a non-Git or commitless source it silently
lands in the checkout — the exact failure the copy claims cannot happen.

**The two halves of the request are not the same size.** The control is a small, well-bounded UI change.
The default is a cross-layer wiring change across three dialogs, a prop type, and a seed that half the
time cannot express the thing it is seeding. `defaultEnvironment` is **shipped, documented, and used
nowhere in this repository** — `grep -rn defaultEnvironment components/ server/ lib/` returns **0
hits**. The capability exists; the wiring is the work.

**"Predefine it for any project" outruns the storage.** `stage_presets` is global
(`server/preset-lookups.ts:66`), `PresetUpsertInput` (`server/preset-contracts.ts:60-72`) has no
project field, and `listPresets` already returns `environmentKind` (`:66`) with no consumer. A default
*per project* is new storage, a new RPC and a migration. Say that in Shape Up rather than faking it.

## 3. Adjudication of the four forced decisions

| Decision | Who decides today | Cost of being wrong | Verdict |
|---|---|---|---|
| **Where the control lives** | nobody — absent | Medium: a wrong home splits the vocabulary across two surfaces | Inside the existing open form body in `preset-manager-form.tsx:59-76`, reusing `PresetExecutionPicker`'s house style. `AGENTS.md`'s UI vocabulary table forbids a new bordered block. The DRY alternative (extend `PresetExecutionPicker`) has a named consequence: `tests/preset-execution-picker.test.mjs`'s element-count assertions move |
| **What its scope is** | preset is global; only per-card exists | **High** — "for any project" is unimplementable without new storage | **Split it.** The preset keeps the coarse attribute (already stored, already returned). The *per-project* default has no home; record it as out of scope rather than simulating it |
| **Seed or override** | nothing seeds; the fallback is computed and discarded | **High** — inverting precedence silently destroys `lib/card-environment.mjs:1-11` | **Seed, never override.** `defaultEnvironment` is documented as *"a seed the user can change, taking precedence over the composer's own environment default when provided"* — the requested behaviour verbatim. `selectCardEnvironment(requested, fallback)` keeps the composer's value when it is valid, so a seed that lands is the person's own prefill, not an override |
| **Does it change the issue-import default** | `firstWorktreePreset` — `ORDER BY is_default DESC, name ASC LIMIT 1` (`preset-lookups.ts:114-120`) | Medium: two defaults, two owners | **No, in this scope — stated in the UI copy, not only in `docs/github-issues.md`.** `importGithubIssue` gates on `decideAutomationSpawn`, which resolves through `resolveEffectiveEnvKind` and fails closed (*"Unknown/missing reads as project-default (shared), never as isolated"*, `lib/github-automation-gate.mjs:13-32`) |

**Seed vs override, verified end to end.** All three dialogs forward `request.environment` verbatim into
`selectCardEnvironment`, and the composer's value wins whenever it is valid. So today the composer's
own default always decides, and the preset's kind reaches a card only as a **fallback**. That is
precisely the "the setting did not reach the surface the person was on" failure shape the analysis found
running through the whole 2026 category (Claude Code #81903, #76415, #38949; hermes-agent PR #88360 —
*"isolation intent is resolved per entry point instead of once"*). One resolver, seeded once, overridable
at the moment of use is the practitioner consensus; it is also the smallest thing that can work here.

## 4. The load-bearing constraint the analysis did not spell out

The seed is honest for one half of the control and approximate for the other. Verified this run against
`bb-plugin-sdk-app.d.ts:326-368, 2637-2667`:

| Preset attribute | Seed to send | Schema-valid? | Round-trips to |
|---|---|---|---|
| worktree | `{type:"host", workspace:{type:"managed-worktree", baseBranch:{kind:"default"}}}` | Yes — `hostId` is `z.ZodOptional` | a managed worktree from the project's default base |
| shared checkout | `{type:"host", workspace:{type:"unmanaged", path: ???}}` | Only with `path: null` | the **host's configured checkout**, not the project's source |

The `path` is not a detail. `workerEnvironment` sends the *source project's* path
(`{type:"host", hostId, workspace:{type:"unmanaged", path: source.path}}`), and the composer never
produces a non-null `path` — the SDK says so outright. In a single-project setup the two coincide. In
a multi-project or multi-host setup they do not, and the divergence would be **silent**: the seeded
request is a *valid* environment, so `selectCardEnvironment` returns it by reference with **no**
`environmentFallbackNotice` — the notice exists only when an invalid request is substituted.

That yields the sharpest falsifiable statement in this synthesis:

> A seed for the shared-checkout half can make a preset's stated intent disagree with the card that is
> actually created, with no notice — which is precisely the class of failure the request is trying to
> end. Seeding the worktree half alone has no equivalent failure mode.

Two ways out, and Shape Up must pick one rather than discovering it later:

1. **Seed only what the preset asks for, and let "checkout" mean "don't seed".** The composer's own
   default then decides, which is the host's business, and the preset's honest statement is the
   *fallback* that already exists and is already correct. Cheap, but it leaves the person unable to
   express the shared checkout at creation time — the other half of the request.
2. **Seed both, and state the approximation in the copy** where the preset's kind is set and in the
   card-creation trail. Honest, more work, and it makes the plugin's honesty obligations bite on a
   second path (`lib/card-environment.mjs:74-84` today covers only the spawn path).

Either way the shape is *not* "wire `environmentKind` straight through". A **single mapper**
(`presetKind → CreateThreadEnvironmentArgs | undefined`) in `lib/`, with a node test per kind, is the
unit that makes this decision visible, testable, and reversible when bb's policy moves again.

## 5. Recommendation and sequence

| # | Step | Why here | Size |
|---|---|---|---|
| 1 | **Vocabulary.** One honest attribute name and a wire mapping that does not depend on a host policy the plugin did not write. Decide rename-stored-value vs rename-labels: renaming touches a `CHECK`-constrained column, the fallback seed row (`preset-lookups.ts:83`), the CLI alias (`--workspace`, `cli-draft.ts:100-101`) and `resolveEffectiveEnvKind`'s string compare; keeping the value and fixing labels loses the collision for near-zero cost | Everything below is cheap after this and ambiguous before it | blocking, decision only |
| 2 | **The control**, inside the existing open form body, plus the value made **visible in the list** — `preset-manager-list.tsx:44-53` prints provider/model/reasoning/permission and two pills, so a worktree preset is currently indistinguishable from a checkout preset. `FEATURES.md:1204-1206` changes in the same commit | An invisible stored value is the failure mode the whole analysis is about | small UI + storage round-trip |
| 3 | **The mapper + the seed.** Widen the three dialogs' preset prop (`create-build-dialog.tsx:134` and its two siblings drop `environmentKind` today; `listPresets` and `boardPresets` already carry it), map per §4, pass `defaultEnvironment`. Two lines of type widening; the data is already in memory | Prefill-plus-override, no precedence change, `card-environment.mjs` invariant untouched | medium, one `lib/` unit |
| 4 | **Name the seam in the copy**: the preset's kind is the composer's *seed*, not its rule; the GitHub import path keeps its own default | `ISOLATED_WORKTREE_DETAILS` already promises a preset the person cannot create | copy only |
| — | **Out of scope, recorded as such:** per-project preset storage (new migration + RPC); changing `firstWorktreePreset`'s alphabetical tie-break into a real default; changing `selectCardEnvironment` precedence; renaming the stored enum value | Each is defensible on its own and none belongs in this scope | — |

**Test shape follows behaviour, not literals** (per `AGENTS.md`'s "no bullshit tests" and the standing
bar on copy pins): what the form writes into `form.environmentKind`; what `upsertPreset` receives; what
`defaultEnvironment` the composer receives per preset kind, *including the no-seed case*; and that the
fallback still fires when the seed is absent. A test grepping the form for the literal `new-worktree`
would pass on broken logic **and** break on the vocabulary fix in step 1 — it pins the one thing this
synthesis says is wrong.

## 6. What this hands to Shape Up

- **The problem to shape:** the plugin has a real, correctly-stored isolation attribute that no surface
  can write and no creation path can read; the person asking wants it settable *and* pre-selected, and
  the two halves have different honest answers.
- **Decided here, do not reopen downstream:** the control's home; seed-not-override; the import default
  is unchanged in this scope; the vocabulary question is settled in step 1 and is *blocking*.
- **The open decision Shape Up owns:** which of the two options in §4 — seed both halves with a stated
  approximation, or seed only the worktree half — with the fallback-path consequence spelled out.
- **Explicitly out of scope:** per-project storage; the import default; `selectCardEnvironment`
  precedence.

## 7. What would falsify this

- **If bb's `project-default` policy changes again**, the delegation at `workers.ts:103` changes meaning
  silently, and §5 step 1's "state it, do not delegate it" becomes the only option rather than the
  preferred one. Re-runnable cheaply against one file.
- **If the composer's own default is not a worktree on git projects**, the shared-checkout seed's
  approximation (§4) stops being a silent divergence and the cheapest option becomes correct.
- **If the seed lands but the person never sees it change** — a created but never-flipped control is
  the tell that the preset is the wrong scope and the real request was per-*project* defaults. Nothing
  in the repo settles this; usage would.
- **If `defaultEnvironment` seeding degrades in practice** (vanished host, vanished worktree — both
  documented), the honesty obligation returns and `environmentFallbackNotice` has to reach the composer
  path too. Larger than this scope should absorb.

## 8. Evidence index

**Re-verified in this run (2026-09-30), origin workspace**

- `server/workers.ts:99-103` — the inversion: `project-default` → unmanaged `path`, else `{type:"project-default"}`
- `server/preset-migrations.ts:11` — `CHECK (environment_kind IN ('project-default','new-worktree'))`
- `server/preset-lookups.ts:66,83,114-120,121-132` — `environmentKind` returned, fallback row, `firstWorktreePreset`'s alphabetical tie-break, `effectiveBuildEnvironmentKind`
- `server/preset-contracts.ts:27,60-72` — no project field on the upsert input
- `server/cards-create.ts:249-252` — `selectCardEnvironment(input.environment, workerEnvironment(...))`; the composer's valid value wins
- `lib/card-environment.mjs:1-11,25-35` — the invariant and the fallback-with-notice rule
- `lib/github-automation-gate.mjs:13-32` — `decideAutomationSpawn`, `resolveEffectiveEnvKind` fail-closed
- `components/settings/preset-manager-form.tsx:59-76` — `Name` + `PresetExecutionPicker` only; `preset-manager-list.tsx:44-53` — no environment value shown
- `components/creation/create-build-dialog.tsx:134,162-165` — preset prop type drops `environmentKind`; `defaultProviderId`/`defaultModel`/`defaultReasoningLevel`/`defaultPermissionMode` are seeded, `defaultEnvironment` is not
- `node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk-app.d.ts:326-368` (seed arg schema: `hostId` optional, `managed-worktree`, `unmanaged.path` nullable), `:2637-2667` (seed semantics and every documented round-trip limit)
- `grep -rn defaultEnvironment components/ server/ lib/` → **0 hits**

**External** (full citations in `context-analysis.md` §8)

- get-bb/bb commit `893a05a` (2026-08-12), `thread-default-policy.ts` — the host policy this plugin delegates to
- get-bb/bb commit `17ef167` — the composer-owns-selections contract that makes `defaultEnvironment` the right instrument
- VS Code, *Choose and use an agent harness* — isolation choice remembered across workspaces
- Claude Code docs — `worktree.baseRef`, `sparsePaths`, `symlinkDirectories`; issues #74091 / #81903 / #76415 / #38949 — the "set the default and it did nothing" pattern
- hermes-agent PR #88360 — resolve isolation intent once, not per entry point

**Scope note:** `state.md`, gates and completion state were not touched. No file outside
`strategic/context.md` was written in this run.

---

## Hand-off (workflow mode)

```
stage          : context
description    : Strategic context. Market analysis, JTBD, domain detection. Gated by context:5 (appetite/review mode): Product Spec Ga
status         : done
artifacts      : runs/exec_x0ctpt5p/strategic/context.md
next-candidate : shape
gate           : none
rework-on      : setup
```
