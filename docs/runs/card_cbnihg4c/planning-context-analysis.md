# Strategic context — "choose my checkout or my worktree, once, and have it be the default"

Study topic: the isolation-default question this plugin's Agent Presets modal does not answer,
and what kind of decision it actually is — a per-card picker value, a preset attribute, a
project policy, or a host capability the plugin is borrowing.
Geographic focus: Global (the category landscape), applied to one host.

Method: `stelow-product-multi-method-market-analysis`, Variant 1 (General Deep Analysis) —
PESTLE, Foresight, Delphi and Wardley across three time horizons, then adjudicated against the
four decisions the request and the recon force.

---

## 0. The finding that reorganizes the question

The intake reads as one missing control. The recon proves the control is missing and that the
fallback already exists server-side. What the recon did not surface — and what changes the
shape of the feature — is that **the two words in the requested control mean opposite things in
the two layers**.

| Layer | Token | What it resolves to |
|---|---|---|
| Stelow preset (`preset-migrations.ts:11` CHECK constraint) | `project-default` | `{type:"host", workspace:{type:"unmanaged", path}}` — the **shared project checkout** (`workers.ts:99-101`) |
| Stelow preset | `new-worktree` | `{type:"project-default"}` — handed to bb and resolved by **bb's** policy (`workers.ts:103`) |
| bb server (`thread-default-policy.ts`, commit `893a05a`, 2026-08-12) | `{type:"project-default"}` | **a fresh managed worktree** when the source has a usable base branch; the source checkout only when it does not (non-Git dir, zero commits) |

So Stelow's `project-default` means "not isolated" while bb's `project-default` means "isolated
whenever git allows". The plugin depends on that inversion today — `new-worktree` works *only*
because bb reads the token it forwards as "give me a worktree". That is a real, load-bearing
coupling to a host policy that was deliberately changed six weeks ago, in a commit whose own
summary reads "prefer an isolated worktree … or work in that source checkout when it does not".

Consequences that shape every later stage:

1. **A two-value radio labelled "Project checkout / Worktree" is the wrong control shape.**
   The request names the two options the reader already has in their head; the enum's two
   values are not those two options, and one of them is a misnomer inside this codebase. Any
   proposal that renders `project-default | new-worktree` as two radio buttons ships a control
   whose label and whose effect disagree for one of its two states.
2. **The `new-worktree` path is the fragile half.** It is correct by delegation to a host
   policy, on a plugin-server RPC that takes `{type:"project-default"}` and gets back whatever
   bb decides. A non-Git project source or a commitless repo silently lands the worker in the
   checkout — the exact failure `IsolatedWorktreeCheck`'s copy claims cannot happen.
3. **"Predefine it for any project" is a request for a *project*-scoped policy, and the plugin
   has no project-scoped storage for presets at all.** Presets are global rows in
   `stage_presets` (`preset-lookups.ts:66`); bands are global too. The only per-project
   selection today is the card's own choice and bb's `projectId` on the RPC.

The honest reframe: the request asks for one control and is really asking for **a scope
(preset → project) plus a vocabulary (checkout vs worktree) plus a precedence order (preset vs
picker vs host policy)**. Those are three decisions, and the third is where the bug lives.

## 1. Recent Past (≈1 year ago) — isolation was a per-invocation flag, not a policy

**PESTLE.** *Technological*: through 2025, coding agents got isolation by explicit request —
`Agent({ isolation: "worktree" })`, `--worktree`, a `--new-environment worktree` flag. Every
surface invented its own spelling, and none of them persisted a choice: the flag applied to one
dispatch and the next dispatch started wherever it liked. *Political/legal*: nothing forced
isolation, because pre-2026 the failure was a dirty working tree, not a breach. *Economic*:
worktrees cost disk and dependency installs (`node_modules` is not shared), so isolation was
sold as opt-in overhead. *Social*: practitioners documented isolation as the thing you turn on
for parallel work, not as a default posture.

**Foresight.** Strong signal, visible in the 2026 issue trackers: the *setting* arrived before
the *default* did. Claude Code's `worktree.baseRef` (`fresh` | `head`) shipped in v2.1.133 as a
global toggle, and the very next requests were for per-dispatch override (#74091) arguing the
decision "belongs to the individual dispatch, not the session". Weak signal, and the one that
matters here: the failure reports are not about the setting being wrong, they are about **the
setting not reaching the surface the person was on** — `worktree.baseRef` set in project
settings and ignored by desktop sessions (#81903), `worktree.bgIsolation` with no effect on
interactive session creation (#76415), `isolation:"worktree"` silently dropped on the
TeamCreate path so the agent ran in the main checkout (#38949). The capability was fine; the
wiring was missing, and it failed silently.

**Delphi.** Practitioner consensus across the surveyed trackers converges on four rules:
isolation intent must be resolved **once, at a single layer**, not per entry point (the
hermes-agent unification PR is the purest expression — "isolation intent is resolved per entry
point instead of once" is named as the defect); a config value that silently does not reach a
surface is worse than no value, because the reader believes it took effect; a default must be
**visible and changeable at the moment of use**, not only in a settings screen; and "default"
must never silently *replace* an explicit human choice.

**Wardley.** The chain a year ago:

```
User request
  ↓
[Per-call flag: --worktree / isolation:"worktree"]   ← Custom, not persisted
  ↓
[git worktree add]                                    ← Commodity (git itself)
  ↓
[Separate working copy + own branch]                  ← Genesis
```

Nothing between the flag and git. No place a *preference* could live, which is exactly why
adding one is a design problem rather than a form field.

## 2. Current Trends (today → 1 year) — isolation became a remembered default, and the remembering is the fragile part

**PESTLE.** *Technological*: the category has converged on "remember the last isolation choice
and prefill the picker". VS Code's Agents window offers New Worktree vs Folder and — the
load-bearing detail — *"after you start a session, VS Code remembers your isolation choice across
workspaces"*; a new worktree forces `Allow all` permissions, so the isolation choice also
determines the permission posture, which is why it is worth remembering rather than re-asking.
Claude Code's desktop app creates a worktree per session automatically. bb's own server policy
(`893a05a`) moved the other direction: `project-default` now *is* a worktree when git permits,
making isolation the server's choice rather than the caller's. *Economic*: disk and dependency
cost is why `{type:"project-default"}` degrades gracefully on non-Git sources instead of
failing. *Legal/ethical*: every source is explicit that worktree isolation is **not a security
boundary** ("A worktree isolates code changes but doesn't restrict the commands or network
access") — the security product is the sandbox, and worktrees only stop file collisions.
*Social*: the complaint pattern has shifted from "how do I isolate" to "I set the default and it
did nothing", which is a wiring complaint, not a capability one.

**Foresight.** Strong signal: the *unit of configuration* is consolidating downward from the
invocation to the **session/workspace**, and the picker is becoming a prefill rather than a
choice — Claude Code's `defaultProviderId` / `defaultModel` / `defaultReasoningLevel` /
`defaultPermissionMode` / `defaultEnvironment` seeds (all present in
`bb-plugin-sdk-app.d.ts:2618-2667`) are that exact shape, documented as *"a seed the user can
change, taking precedence over the composer's own environment default when provided"*. Weak
signal: every documented round-trip limit in that SDK doc is a *silent substitution* —
`{type:"project-default"}` seeds nothing, a vanished host falls back, a vanished worktree falls
back. The seed API's own contract is "best effort, degrade quietly", which means the plugin's
honesty obligations (`environmentFallbackNotice`, `card-environment.mjs:74-84`) do not transfer
to the seed and must be re-implemented if the feature lands.

**Delphi.** Consensus is sharp on the precedence order and split on the scope. Precedence is
near-universal: **explicit human choice at the moment of use > stored preference > host
default**. Scope is the open question — Claude Code resolves it with layered settings files
(user / project / local / managed), VS Code with a remembered per-workspace choice plus an
opening setting. Both converge on the same practical answer: *a per-project default plus a
per-use override*. The one documented disagreement is worth carrying: the bb server decided that
`project-default` should be a worktree, while Stelow's `resolveEffectiveEnvKind` decides the
opposite — *"Unknown/missing reads as project-default (shared), never as isolated: fail
closed"* (`github-automation-gate.mjs:25-32`). Two fail-opposite defaults inside one product.

**Wardley.** The chain today:

```
Users
  ↓
[Environment picker — prefilled, changeable]        ← Product (the differentiator)
  ↓
[Session/workspace default (remembered choice)]      ← Opening, inconsistent
  ↓
[Server defaulting policy — project-default]        ← Moving up fast
  ↓
[git worktree / checkout]                            ← Commodity
```

Movement is **upward into the policy layer**, and Stelow is on the wrong side of it: its
`workerEnvironment` treats the host's `project-default` as a delegation to make a worktree,
while the host keeps redefining what that token means. Everything worth compounding here is
the *resolution record* — what was asked, what was chosen, what was used — not the picker.

## 3. Future Predictions (next 5 years)

**PESTLE.** *Political/legal*: provenance of where an agent's writes landed becomes an audit
question; the "asked vs used" notice Stelow already writes (`environmentFallbackNotice`) is
the shape regulators will expect. *Economic*: disk and cold-start costs push toward
sparse-checkout worktrees and shared dependency trees — Claude Code already ships
`worktree.sparsePaths` and `worktree.symlinkDirectories`, which is the cost problem being
solved at the git layer rather than by not isolating. *Technological*: environment selection
converges into a declarative per-project manifest (`.claude/settings.json` → `agent` key →
per-dispatch override), because every harness is converging on "one resolver, many entry
points". *Social*: "New worktree" as a thing you pick per session loses status; isolation
becomes the thing you set once per project and stop thinking about — which is precisely the
request.

**Foresight.** Strong signal: the `defaultEnvironment` seed family already exists in the
plugin SDK with documented precedence and documented degradation limits, and it is **unused
anywhere in this repository** (`grep defaultEnvironment` over `components/` and `server/`
returns nothing). A capability shipped, documented, unused, and unnamed in this product's
prose is a strong signal that the *wiring*, not the capability, is where the next year of work
goes. Weak signal: `firstWorktreePreset`'s alphabetical tie-break
(`ORDER BY is_default DESC, name ASC LIMIT 1`, `preset-lookups.ts:114-120`) is the shape a
"default" has before anyone decides what default means.

**Delphi.** Consensus projection: presets stay global; isolation defaults become per-project;
the human-at-the-moment override never goes away, because the value is unrepresentable
per-call (issue #74091's stacked-vs-fan-out argument generalizes). Consensus is thinnest on
whether the *preset* is the right owner — the split is between people who think of a preset as
"what kind of worker this is" (model, cost, permission) and people who think of it as "where
this kind of work happens". Stelow's own prose is on the fence: `FEATURES.md:1204-1206` says
*"environment kind stays a preset field"* — a sentence written to explain an absence, not to
claim an ownership.

**Wardley.** Where this lands over five years:

```
Project policy (committed, per project)      ← becomes the only real default
  ↓
Preset attribute (worker shape + coarse env)  ← stays, but demoted to a hint
  ↓
Per-use picker (seeded, always overridable)   ← permanent
  ↓
git worktree / checkout                       ← was never the interesting part
```

## 4. Adjudication: the four decisions the request actually forces

| Decision | Options | Who decides today | Cost of being wrong | Verdict |
|---|---|---|---|---|
| **Where does the control live** | preset manager form / shared execution picker / project settings surface | nobody — absent | Medium: wrong home churns tests and splits the vocabulary across two surfaces | **Preset manager form, but see §0 — it is a radio over a misnamed enum, so it needs a vocabulary fix, not just a field** |
| **What is its scope** | global preset / per-project / per-card | preset is global; only per-card exists | **High**: "for any project" is unimplementable without new storage | **Split the scope: the preset keeps the coarse attribute; the *default for a project* is the part that needs a home and does not have one. Say so, do not fake it** |
| **Does it seed the picker or override it** | `defaultEnvironment` seed / change `selectCardEnvironment` precedence / preset-only fallback | nothing seeds; fallback is computed and discarded | **High**: inverting precedence silently destroys `card-environment.mjs:1-11`'s invariant | **Seed, never override.** The SDK seed is documented as changeable-by-the-human and takes precedence over the host default; precedence inversion is the trap the recon named |
| **Does it change the issue-import default** | yes / no / both paths converge | `firstWorktreePreset`, alphabetical | Medium: two "defaults" is the confusion the request is trying to remove | **No, in this scope — and that must be stated in the UI copy, not only in a doc.** `IsolatedWorktreeCheck`'s own text already points at a preset the person cannot create |

**Where the control lives.** The cheap home is `PresetManagerFormView`
(`preset-manager-form.tsx:59-76` renders exactly `Name` + `PresetExecutionPicker`); the DRY home
is `PresetExecutionPicker`, shared with the card-assign dialog — and that choice has a named
test consequence (`tests/preset-execution-picker.test.mjs`'s element-count assertions move).
The recon is right that this is a design decision, not an implementation detail. One constraint
the recon did not flag: `AGENTS.md`'s UI vocabulary table requires a section to be
`SECTION_SURFACE`/`DisclosureSection`, which argues for the control inside the existing open
form body rather than a new bordered block.

**Scope.** This is where the request outruns the storage. `stage_presets` is global
(`preset-lookups.ts:66`); there is no `project_id` column and
`PresetUpsertInput` (`preset-contracts.ts:60-72`) has no project field. "A default for any
project" therefore means one of three different things, and the shape proposal must pick one:
(a) one global preset whose kind is the default everywhere; (b) a per-project mapping, which is
new storage, new RPC, and a new migration; (c) a project-level default that bb already owns
(`{type:"project-default"}`) and Stelow merely stops fighting. (c) is the cheapest and the one
the host is already moving toward — and it is the option the request's own phrasing ("predefine
and use this in bb") most resembles.

**Seed vs override.** `defaultEnvironment` is documented (SDK `app.d.ts:2637-2667`) as *"a seed
the user can change, taking precedence over the composer's own environment default when
provided"* — which is the requested behaviour verbatim, prefill plus human override. The
obstacle is not the SDK: it is that no Stelow surface knows the preset's kind at creation time.
`analysisPreset` (`build-panel-state.ts:226-232`) narrows the preset to
`{providerId, modelId, reasoningLevel, permissionMode, name}` and the three dialogs' prop types
drop `environmentKind` entirely (`create-build-dialog.tsx:135`,
`create-research-dialog.tsx:110`, `create-explore-dialog.tsx:110`) — while `listPresets` already
returns it and `boardPresets` already carries it. Two lines of type widening; the data is
already in memory. And because all three dialogs forward `request.environment` verbatim
(`create-build-dialog.tsx:65`), the composer's own default is what always wins today.

**Issue-import.** Unchanged by any of this. `importGithubIssue`
(`github-issue-flow.ts:201-234`) gates on `decideAutomationSpawn` and resolves
`firstWorktreePreset`; the composer's environment picker is not in that path. A preset control
that lands without touching this leaves two defaults with two owners — which is precisely what
the person asking is trying to end. The honest move is to say so in the copy the reader sees
(`ISOLATED_WORKTREE_DETAILS` already promises "Needs a New-worktree preset in Agent Presets"),
not only in `docs/github-issues.md`.

## 5. The one naming decision that should be settled before interface proposals

Two words, four meanings, in one product:

- Stelow `project-default` = the shared checkout (never isolated)
- Stelow `new-worktree` = delegate to bb's `project-default`
- bb `{type:"project-default"}` = managed worktree when git permits
- The UI string the person reads is "Project checkout" / "Worktree" (`ISOLATED_WORKTREE_LABEL`)

The reader's two options are real and correct. The enum's two values are not those options. Any
radio that renders the enum's values literally will be **wrong for exactly one of its two
states**, and it will be wrong in the direction that costs the most: a person selecting
"Project checkout" through a control labelled `project-default` gets a worktree when the
project is a git repository, which is every project they use.

The mapping that survives both layers:

| Preset attribute (honest name) | Wire value sent | Human label |
|---|---|---|
| `shared-checkout` | `{type:"host", workspace:{type:"unmanaged", path}}` — stated, not delegated | Project checkout |
| `new-worktree` | `{type:"host", workspace:{type:"managed-worktree", baseBranch:{kind:"default"}}}` — stated | Worktree |

Renaming the stored value is a migration on a `CHECK`-constrained column with a fallback seed
row (`preset-lookups.ts:83`), a CLI flag alias (`--workspace`, `cli-draft.ts:100-101`), and
`resolveEffectiveEnvKind`'s string comparison (`github-automation-gate.mjs:29`). Keeping the
stored value and fixing only the *labels* is cheaper and loses the collision. That trade is a
shape decision and belongs upstream of the interface proposals.

## 6. Recommendation

**Build the control and the seed. Do not build the project scope, and do not touch the import
default.** In dependency order:

1. **Vocabulary first (blocking).** Settle §5 — one honest attribute name, and a wire mapping
   that does not depend on a host policy the plugin did not write. Everything below is cheaper
   after this and ambiguous before it.
2. **The control.** An environment-kind control inside the existing form body in
   `preset-manager-form.tsx`, reusing `PresetExecutionPicker`'s house style or a named token
   (`tests/card-design-tokens.test.mjs`), `min-h-11` + `cursor-pointer`. Also make the value
   visible in the list (`preset-manager-list.tsx:44-53` currently prints provider/model/reasoning
   /permission and two pills — a `new-worktree` preset is visually identical to a
   `project-default` one). `FEATURES.md:1204-1206` changes in the same commit.
3. **The seed.** Widen the three dialogs' `analysisPreset` prop to carry `environmentKind` and
   pass `defaultEnvironment` to the composer. This is prefill-plus-override, it is what the SDK
   was built for, and it does **not** touch `selectCardEnvironment`'s precedence — the
   `card-environment.mjs:1-11` invariant survives intact, and
   `tests/card-environment.test.mjs` / `tests/card-creator-environment-optional.test.mjs` keep
   passing unchanged.
4. **Name the seam in the copy.** The preset's kind is the composer's *seed*, not its rule. The
   GitHub import path keeps its own default; say that where the person reads it, not only in
   `docs/github-issues.md`.
5. **Explicitly out of scope, recorded as such:** per-project preset storage; changing
   `firstWorktreePreset`'s alphabetical tie-break into a real default; changing
   `selectCardEnvironment` precedence.

**Test shape that follows from this** (per `AGENTS.md` "no bullshit tests", and the standing
rule against copy pins): behaviour, not literals. What the form writes into `form.environmentKind`;
what `upsertPreset` receives; what `defaultEnvironment` the composer receives per preset kind;
and that the fallback still fires when the seed is absent. A test grepping the form for the
string `new-worktree` would pass on broken logic and break on the vocabulary fix in §5.

## 7. What would falsify this

- If bb's `{type:"project-default"}` policy changes again, the `new-worktree` delegation in
  `workers.ts:103` silently changes meaning — which would make §5's "state it, do not delegate
  it" the *only* durable option, not the preferable one. This analysis can be re-run cheaply
  against one file.
- If a preset turns out to be the wrong scope (people want the default per *project*, and no
  preset change satisfies that), step 2 ships a control nobody uses twice and the real request
  stays unanswered. The tell would be usage: a control created but never flipped back.
- If `defaultEnvironment` seeding proves unreliable in practice — its documented degradation
  (a seed that resolves to nothing, a vanished host falling back) means the person may see
  `project-default` when the preset said worktree with no notice. If that happens, the honesty
  obligation returns and `environmentFallbackNotice` has to reach the composer path too, which
  is a larger change than this scope should absorb.
- If `firstWorktreePreset`'s alphabetical tie-break is load-bearing for someone today (two
  worktree presets, relying on which sorts first), then the "leave the import default alone"
  recommendation is wrong and the import path needs the same vocabulary work. Nothing in the
  repo shows such a person; nothing rules one out.

## 8. Sources

- get-bb/bb, commit `893a05a` *"Allow Tasks dispatch without requiring Git (#1396)"*, 2026-08-12 — server-owned project-default policy prefers a managed worktree when the source has a usable base branch — https://github.com/get-bb/bb/commit/893a05ae60c71546b645ced75c52c8eaff9171bd
- get-bb/bb, `apps/server/src/services/threads/thread-default-policy.ts` (current `main`) — https://github.com/get-bb/bb/blob/main/apps/server/src/services/threads/thread-default-policy.ts
- get-bb/bb, `apps/app/src/components/pickers/WorktreePicker.tsx` + `NewThreadPromptBox.tsx` — composer environment/branch/worktree picker assembly — https://github.com/get-bb/bb/blob/main/apps/app/src/components/promptbox/NewThreadPromptBox.tsx
- get-bb/bb, `docs/worktrees.md` — managed worktree lifecycle, `.worktreeinclude`, `.bb-env-setup.sh`, `--new-environment worktree` — https://github.com/get-bb/bb/blob/main/docs/worktrees.md
- get-bb/bb commit `17ef167` *Add `experimental_NewThreadComposer` to the plugin SDK (#911)* — composer-owns-selections contract and `NewThreadRequest` shape — https://github.com/get-bb/bb/commit/17ef167c3e94fff5990874cd705acb0801dadf96
- VS Code, *Choose and use an agent harness* — "Code isolation: whether changes go into the current folder or a separate Git worktree"; isolation choice remembered across workspaces — https://code.visualstudio.com/docs/agents/run/agent-harnesses
- Claude Code docs, *Run parallel sessions with worktrees* and *All settings* — `worktree.baseRef`, `worktree.sparsePaths`, `worktree.symlinkDirectories` — https://code.claude.com/docs/en/worktrees
- Claude Code issue #74091, *Per-call `baseRef` on the Agent/Task tool to override the session-wide `worktree.baseRef` setting* — a session-scoped toggle cannot express a per-dispatch decision — https://github.com/anthropics/claude-code/issues/74091
- Claude Code issue #81903, *Desktop app: session worktrees ignore `worktree.baseRef: "head"`* — a setting that does not reach the surface the person is on — https://github.com/anthropics/claude-code/issues/81903
- Claude Code issue #76415 / #38949 — `worktree.bgIsolation` no effect on interactive session creation; `isolation:"worktree"` silently ignored on the TeamCreate path — https://github.com/anthropics/claude-code/issues/38949
- NousResearch/hermes-agent PR #88360, *unify agent isolation across TUI, messaging gateway, and API server* — "isolation intent is resolved per entry point instead of once" — https://github.com/NousResearch/hermes-agent/pull/88360
- Local: `components/settings/preset-manager-form.tsx:59-76`, `components/settings/preset-manager-list.tsx:44-53`, `components/settings/preset-manager-types.ts:20,48`, `components/settings/preset-manager-crud.ts:78`, `components/settings/preset-assign-options.tsx:11`, `components/creation/create-{build,research,explore}-dialog.tsx`, `components/panels/build-panel-state.ts:171,226-232`, `components/isolated-worktree-check.tsx`, `server/workers.ts:96-104`, `server/cards-create.ts:249-252`, `server/preset-lookups.ts:66,83,114-132`, `server/preset-migrations.ts:11,57`, `server/preset-contracts.ts:60-72`, `server/preset-handler-crud.ts:84,101,115`, `server/platform-rpc-contract.ts:80,100`, `server/github-issue-flow.ts:201-234`, `server/github-automation-rules.ts:197`, `server/runtime/cli/cli-draft.ts:80,100-101`, `lib/card-environment.mjs:1-11,25-35,74-84`, `lib/github-automation-gate.mjs:13-32`, `lib/preset-assignment.mjs:38`, `FEATURES.md:52,675,1204-1206`, `docs/github-issues.md:20-21,64-67,97-98`, `node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk-app.d.ts:2618-2667,326-368`

---

## Hand-off (workflow mode)

```
stage          : context
description    : Strategic context. Market analysis, JTBD, domain detection. Gated by `context:5` (appetite/review mode): Product Spec Ga
status         : done
artifacts      : runs/exec_x0ctpt5p/strategic/context-analysis.md
next-candidate : shape
gate           : none
rework-on      : setup
```