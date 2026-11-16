# Recon — setup stage

Recipe `setup-recon`, task `repository-recon`. Read-only survey of the two
halves the intake names. Nothing here decides scope; it records what exists,
what is unreachable, and which file owns each missing link.

## Receipt

`context/recon-receipt.json` (`stelow-recon-v2`, kind `feature-recon`).
Method **cymbal**; `cymbal`, `ripwire`, `sem`, `ast-grep` all available,
`missing: []`. Workspace `/home/deploy/repos/bb-plugin-stelow` (git, branch
`fix/skipped-rework-scope-deadlock`).

## The claim under test

> "In the Agent Presets modal, editing a preset does not show the option to
> choose between project checkout or worktree, so no default can be set per
> project. Could that be predefined and used in bb, and when opening an issue
> for any project, come up as the default what was selected in the preset, with
> the person accepting or changing it at creation time?"

Two facts to check: (a) is the control really absent, (b) does a preset's
environment kind already act as a creation default.

**Both are true, and (b) is true in a way that is currently dead code.**

---

## Half 1 — the control is genuinely absent

`environment_kind` is a first-class column with a CHECK constraint, present in
every layer except the one that renders it:

| Layer | File | Status |
|---|---|---|
| Schema | `server/preset-migrations.ts:11` — `TEXT NOT NULL DEFAULT 'project-default' CHECK (environment_kind IN ('project-default','new-worktree'))` | present |
| Migration backfill | `server/preset-migrations.ts:57` | present |
| Fallback seed row | `server/preset-lookups.ts:83` (`insertFallbackDefault`) | present, hardcodes `"project-default"` |
| RPC output | `server/platform-rpc-contract.ts:80` (`listPresets` → `environmentKind: z.string()`) | present |
| RPC input | `server/platform-rpc-contract.ts:100` — `z.enum(["project-default","new-worktree"]).default("project-default")` | present |
| Row / upsert types | `server/preset-contracts.ts:69` (`PresetUpsertInput.environmentKind`, already the literal union — no cast) | present |
| Persistence | `server/preset-handler-crud.ts:84,92,101` (update + insert) | present |
| Client form type | `components/settings/preset-manager-types.ts:20` — `environmentKind: "project-default" \| "new-worktree"` | present |
| Form hydration | `preset-manager-types.ts:48` (`formFromPreset`) | present |
| Save path | `components/settings/preset-manager-crud.ts:78` | present |
| **The form body** | **`components/settings/preset-manager-form.tsx:59-76`** | **ABSENT** |

`PresetManagerFormView` renders exactly two children inside `grid gap-2`:
a `Name` `Input` and `<PresetExecutionPicker>`. `PresetExecutionPicker`
(`preset-execution-picker.tsx`) covers provider/model/reasoning and permission
mode only. Nothing writes `form.environmentKind`, so the value the form carries
is whatever `formFromPreset` read — which is why **editing a built-in or saved
`new-worktree` preset and pressing Save changes nothing about its environment**:
the round trip is honest, the control is just not there to change it.

The value is also **invisible in the list** — `preset-manager-list.tsx:48-53`
prints `providerId/modelId · reasoningLevel · permissionMode` and two pills
(`default`, `built-in`). A `new-worktree` preset is visually identical to a
`project-default` one.

### The only ways to set it today

1. **CLI** — `server/runtime/cli/cli-draft.ts:100-101`:
   `bb stelow preset add --name X --workspace new-worktree`. Real, working,
   documented in `ADD_USAGE` (`cli-draft.ts:80`), and invisible in the UI.
2. **Direct SQL** — not a supported path.

So the intake's observation is exact: the feature exists server-side and is
reachable only by typing a CLI flag.

---

## Half 2 — the default exists, and the composer always overrides it

This is the finding that shapes the whole feature.

### The fallback is already wired

`server/cards-create.ts:249-252`:

```ts
const environment = workspace.exploratory
  ? workerEnvironment(workspace.source, params, true)
  : selectCardEnvironment(input.environment, workerEnvironment(workspace.source, params));
```

`workerEnvironment` (`server/workers.ts:96-104`) is the preset's kind made
concrete: `project-default` → `{type:"host", workspace:{type:"unmanaged", path}}`;
anything else → `{type:"project-default"}` (BB provisions the worktree).

So *if* the caller sends no environment, the preset's `environment_kind`
already decides where the worker runs. The second half of the request is, at
the server, already built.

### Why it never fires

`createCard.environment` is **optional but always present in practice**.
`NewThreadRequest.environment` is a *required* field of the host's submission
type (`bb-plugin-sdk-app.d.ts:2576`, non-optional), and all three creation
dialogs forward it verbatim:

- `components/creation/create-build-dialog.tsx:65`
- `components/creation/create-research-dialog.tsx:57`
- `components/creation/create-explore-dialog.tsx:57`

each passing `environment: request.environment`. `selectCardEnvironment`
(`lib/card-environment.mjs:25-35`) passes any recognised shape through **by
reference**. The composer's value is always recognised. Therefore
`workerEnvironment(...)` — the only consumer of `preset.environment_kind` at
creation — is evaluated and then discarded on every card created from a
composer dialog.

Its documented behaviour is deliberate and should not be undone: the docstring
at `card-environment.mjs:1-11` says the composer owns selection and the preset
is only a fallback, precisely so "I picked worktree but nothing happened"
cannot happen silently. `environmentFallbackNotice` (`:74-84`) is the honesty
mechanism when substitution does occur.

**So the request's second half is not "add a fallback that does not exist". It
is "stop discarding an existing fallback, by seeding the composer's picker from
the preset" — which changes who decides, not what is decided.**

### The seam that does it without a fight

`experimental_NewThreadComposer` already accepts a seed for exactly this:

```
defaultEnvironment?: CreateThreadEnvironmentArgs;   // app.d.ts:2667
```

Seed semantics, quoted from the SDK: *"a seed the user can change, taking
precedence over the composer's own environment default when provided"*, with
value-compared re-seeding and the documented round-trip limits (`project-default`
seeds nothing; a vanished host falls back). This is precisely the requested
behaviour — prefill, human may accept or change — and it is one prop on three
dialogs.

**`defaultEnvironment` is currently used nowhere in the repo** (grep across
`components/` and `server/` returns nothing). Same for `useComposer().experimental_setSelection`
(`app.d.ts:2320`), the imperative alternative.

The obstacle is not the SDK. It is that **no Stelow client surface knows a
preset's environment kind at creation time**: `analysisPreset`
(`components/panels/build-panel-state.ts:226-232`) returns the band/default
preset object narrowed to `{providerId, modelId, reasoningLevel, permissionMode, name}`
— `environmentKind` is dropped by the prop type in all three dialogs
(`create-build-dialog.tsx:135`, `create-research-dialog.tsx:110`,
`create-explore-dialog.tsx:110`), even though `listPresets` returns it and
`boardPresets` carries the full objects (`build-panel-state.ts:171`).

---

## The issue path — a different, already-existing default

"Opening an issue for any project" is the GitHub import path, and it already
has its own environment default that is **not** the composer's.

`server/github-issue-flow.ts:201-234` (`importGithubIssue`):

- `isolated: true` → gate via `decideAutomationSpawn`
  (`lib/github-automation-gate.mjs:13-17`), then
  `presetId = resolveWorktreePreset(ctx)` → `getWorktreePresetId()` →
  `firstWorktreePreset` (`preset-lookups.ts:114-120`).
- Refusal names the redirect: *"Create a New-worktree preset in Agent Presets,
  or uncheck Isolated worktree…"* — which today points at a preset the person
  can only create by CLI.
- A parked isolated import pins the worktree preset immediately
  (`github-issue-flow.ts:230-233`) so the choice survives until Start.

`firstWorktreePreset` is `WHERE environment_kind = 'new-worktree' ORDER BY
is_default DESC, name ASC LIMIT 1`. **That is the de facto "default worktree
preset", and it is alphabetical and implicit** — a person with two worktree
presets cannot say which one they meant.

The same accessor backs automation rules (`server/github-automation-rules.ts:197`),
whose gate uses `getEffectiveBuildEnvironmentKind` (`preset-lookups.ts:122-132` →
`resolveEffectiveEnvKind`), where **the build band's preset wins over any
passed preset**. `resolveEffectiveEnvKind` fails closed: unknown reads as
`project-default`, never as isolated.

The import dialog's own checkbox starts unchecked
(`components/github/github-import-submit.ts:42`, `useState(false)`), rendered
by the shared `IsolatedWorktreeCheck` (`components/isolated-worktree-check.tsx`),
whose own copy already tells the reader the feature needs a preset they cannot
create: *"Needs a New-worktree preset in Agent Presets"* (`:11`).

**Consequence for scoping:** "opening an issue" and "starting a card from the
composer" are two different defaults with two different owners today. A single
"preset decides" story has to name which of them it is changing, because
changing the composer seed does **not** change the import default, and vice
versa.

---

## Secondary finding: the override path silently inherits, correctly

`server/preset-assignments.ts:57-63` — a card override preset copies
`base.environment_kind` from the preset it overrides. Same in
`lib/preset-assignment.mjs:38` (`environmentKind: defaultPreset?.environmentKind ?? "project-default"`).

So the per-card "Change preset…" dialog already honours the base preset's
environment kind. Nothing to fix there — but it does mean a half-implemented
UI control would produce a *differently-inheriting* override depending on which
surface wrote the base, which is the kind of drift worth pinning in a test.

---

## Constraints any change here must respect

| Constraint | Source | Consequence |
|---|---|---|
| `min-h-11` touch targets, `cursor-pointer` on every clickable | `AGENTS.md` (state, **not tested** — 76 raw buttons outstanding) | A new radio/select control is expected to comply; nothing enforces it |
| Sections are `SECTION_SURFACE` or `DisclosureSection`; starts closed unless `live`/`blocking` | `tests/card-surface-consistency.test.mjs` | The new control belongs inside the existing open form body, not a new bordered section |
| Shared names imported, never redefined; type sizes from `lib/design-tokens.ts` | `tests/card-design-tokens.test.mjs` | A new environment-kind control must reuse `PresetExecutionPicker`'s house style or a named token |
| 400 file / 50 function line limits; `scripts/source-debt.json` ledger | `tests/source-shape.test.mjs`, `tests/source-budgets.test.mjs` | `preset-manager-form.tsx` is 92 lines — room, but the ledger is append-only |
| Any user-facing change updates `FEATURES.md` **in the same commit** | `AGENTS.md` (Feature inventory) | `FEATURES.md:1204-1206` currently states *"environment kind stays a preset field"* — that sentence becomes false the moment a control exists |
| Regex pins must constrain topology/counts/refusals | `AGENTS.md` (Test value) | A test that greps for the literal string `new-worktree` in the form is a copy pin and will be rejected; pin behaviour (what the form writes, what the save sends, what the composer seed receives) |
| No circular validation on critical paths | `AGENTS.md` | Per `stelow-workflow-testing-ai-code`, the agent that writes the code may not be the test's only author |

### Tests that will need to move

- `tests/preset-ui.test.mjs` — pins the manager form's composition
  (`managerForm` window, `<PresetExecutionPicker` count, the
  `grid gap-2` body). Line 193/224 already use `environmentKind: "new-worktree"`
  in fixtures, so the *data* is anticipated; only the *rendering* is unpinned.
- `tests/component-rule-seams.test.mjs:160,186` — pins the exact `upsertPreset`
  argument object including `environmentKind: "local"`. A contract-shape pin;
  survives a UI change unchanged.
- `tests/preset-execution-picker.test.mjs` — transpiles the picker and asserts
  the rendered tree. If the environment control lands *inside*
  `PresetExecutionPicker` (shared with the assign dialog), this file's element
  count assertions are the ones that move. If it lands in
  `PresetManagerFormView` only, they do not. **This is a design decision with
  a test consequence, not an implementation detail.**
- `tests/card-environment.test.mjs`, `tests/card-creator-environment-optional.test.mjs` —
  pin the fallback semantics. Must keep passing: the fallback is the safety net
  the composer seed sits on top of.

---

## Open questions this recon cannot settle

1. **Which composer, and does the seed or the fallback change the safety
   property?** Seeding the picker changes *who decides* while preserving the
   human override. Changing `selectCardEnvironment` precedence would invert the
   invariant `lib/card-environment.mjs:1-11` was written to protect. The first
   is almost certainly the right answer; the second is a trap.
2. **Composer seed vs. fallback — which is the "default"?** If half 1 only adds
   the control and half 2 only seeds the composer, then the `workerEnvironment`
   fallback still governs every non-composer caller (research fan-out,
   `cli-split`, GitHub import, restart). Decide whether the preset's kind is
   meant to be authoritative there too, or whether composer-only is the honest
   scope.
3. **`firstWorktreePreset`'s alphabetical tie-break.** Two worktree presets
   today resolve by name. Any "default" story needs an explicit disambiguation
   before it can be called a default.
4. **Does the environment control belong in the shared picker?** Half 1's
   cheapest home (`PresetManagerFormView`) and its DRY home
   (`PresetExecutionPicker`, also used by the card assign dialog) lead to
   different UI surfaces and different test churn. Worth deciding before
   interface proposals.