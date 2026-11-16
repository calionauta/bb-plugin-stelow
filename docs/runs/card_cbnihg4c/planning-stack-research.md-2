---
stage: planning
task: planning-stack
skill: stelow-workflow-tech-planning
step: tech:5
name: preset-environment-kind
product_type: software
stack_source: existing:node
detected_at: 2026-09-30
repository: /home/deploy/repos/bb-plugin-stelow
plugin_version: 0.58.1
---

# Stack research — preset environment kind

`tech:5 — Discover Stack`, run as the `planning-stack` task of the
`planning-research` recipe. Brownfield: `package.json` exists, so `STACK_SOURCE`
resolves to `existing:node` via the skill's detection block. **No stack
question is asked of the user** — the skill treats an inferred stack as settled
and reserves `ask_user_question` for a greenfield project. Everything below was
read out of the repository at the commit this run saw, not recalled.

---

## 1. Tech stack (the frontmatter payload)

```yaml
tech_stack:
  primary: "TypeScript 5.9 (strict, noEmit) + React 19 JSX, ESM, on Node 22"
  ui: "Tailwind v4 (host-provided, no local dependency) + shadcn/ui new-york primitives + @hugeicons/react"
  host: "@get-bb/plugin-sdk 0.4.106 (app + server slots, bundled type surface)"
  storage: "better-sqlite3 12.11 behind the SDK's storage.database handle; presets table with CHECK constraint"
  validation: "zod 4.4 (RPC contract schemas, defineRpcContract)"
  server_http: "hono 4.13 (devDependency; not on the plugin's own import path)"
  test: "node:test (node --test) + assert/strict; 334 test files, no test framework"
  deployment: "bb plugin build → dist/ + bb plugin reload stelow; GitHub Actions ci.yml on Node 22"
  stack_source: "existing:node"
```

## 2. How each fact was established

| Layer | Evidence |
|---|---|
| Runtime | `.node-version` = `22`; `node -v` = v22.22.2; `npm -v` = 10.9.7; `package.json#engines.bb` = `>=0.43`, installed `bb --version` = 0.43.3 |
| Language | `package.json#type: "module"`; `tsconfig.json` `strict: true`, `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `jsx: react-jsx`, `noEmit: true`, `skipLibCheck: false`, path alias `@/* → ./*` |
| Typecheck | `npm run typecheck` = `tsc --noEmit`; TypeScript 5.9.3 installed against `^5.7.0` |
| UI runtime | `node_modules/react` 19.2.8 (transitively via the SDK); **not** a direct dependency — the host supplies React, which is why the plugin cannot pin it |
| Entry points | `app.tsx` calls `definePluginApp` from `@get-bb/plugin-sdk/app`; `server.ts` default-exports `plugin` from `server/plugin-runtime.js` and re-exports `rpcContract`; `package.json#bb` points `server`/`app` at those two files |
| Styling | `tailwind-merge` 3.4.0 + `clsx` + `class-variance-authority` are the only Tailwind-adjacent deps; **`tailwindcss` is not in `package.json`** and not installed. `dist/app.css` carries Tailwind v4 output (`@property --tw-*`, `color-mix(… in oklab, …)`) scoped to `[data-bb-plugin=stelow]` — the **host** compiles the classes, `bb plugin build` does |
| Components | `components.json` = shadcn `new-york`, `tsx: true`, `baseColor: neutral`, `cssVariables: true`, custom registry `@bb`; `components/ui/` holds 18 hand-owned primitives (`button`, `input`, `card`, `dialog`, …) plus several `.ts` helpers that are not components |
| Icons | `@hugeicons/core-free-icons` + `@hugeicons/react`, matching `package.json#bb.branding.icon` |
| Validation | `zod` 4.4.3 as a **runtime** dependency; `server/platform-rpc-contract.ts:100` builds `z.enum(["project-default","new-worktree"])` for `upsertPreset.environmentKind`; `defineRpcContract` comes from `@get-bb/plugin-sdk` |
| Storage | `better-sqlite3` 12.11.1 in devDependencies (native module, bundled by the host); `server/preset-contracts.ts:3` types the handle as `ReturnType<BbPluginApi["storage"]["database"]>`; `server/preset-migrations.ts:3-18` creates the `presets` table with `environment_kind TEXT NOT NULL DEFAULT 'project-default' CHECK (environment_kind IN ('project-default','new-worktree'))` |
| Tests | No framework dependency at all. `tests/*.mjs` = 334 files running on `node:test` + `node:assert/strict`. TypeScript sources are loaded under test via `node --experimental-strip-types --import ./tests/register-ts-source.mjs`, a resolver hook that maps extensionless and `.js`→`.ts` specifiers the way the bundler does |
| Quality gates | `lint` (oxlint), `deadcode` (knip), `duplicates` (jscpd), `architecture` (dependency-cruiser), `quality:shape` (`scripts/check-source-shape.mjs` + `check-source-budgets.mjs`) |
| CI | `.github/workflows/ci.yml`: `actions/setup-node@v4` with `node-version: 22`, then `npm ci` → `typecheck` → `quality:shape` → `quality:report` → `architecture` → `test` → `security:production` |
| Build/deploy | `npm run build` = `bb plugin build && node scripts/postbuild.mjs` (copies `data/`, `references/`, `skills/` into `dist/`, writes `dist/version.json`); `npm run reload` = `bb plugin reload stelow`. No container, no external service — the plugin is loaded by a running BB desktop app |

## 3. Repository shape that constrains this change

- **Three source tiers, enforced by `dependency-cruiser`.** `no-circular-dependencies`; server
  slices must not import `server.ts`; `lib/` must not reach into `app.tsx`, `server.ts`,
  `server/`, `components/`, or `hooks/`. The new preset-kind mapping belongs in `lib/`
  precisely because it must be pure and host-neutral.
- **`lib/` is hand-paired JS + declarations.** 198 `.mjs` modules, 196 paired `.d.mts`
  files (only `release-published.mjs` and `workflow-catalog.mjs` lack types), plus 3 `.ts`.
  A new `lib/` module means an `.mjs` implementation **and** a `.d.mts` declaration — that is
  the house convention, not an optional extra.
- **Size budgets are a build gate, not a preference.** `check-source-budgets.mjs` caps files at
  400 lines and functions at 50, with over-ceiling entries allowed only if listed in
  `scripts/source-debt.json`. Two functions this change must edit are *exactly* at their
  recorded ceilings: `components/settings/preset-manager-form.tsx:PresetManagerFormView` = 73,
  `components/settings/preset-manager-list.tsx:PresetManagerList` = 74. The file sizes are 92
  and 87 lines, so both are well under the file cap — the pressure is on the functions.
- **`server/` is 100 `.ts` files** plus `server/decisions/` and `server/runtime/` subtrees;
  `components/` holds 131 `.tsx` files.

## 4. Stack implications for the seven approved scopes

| Scope | Stack consequence |
|---|---|
| `env-seed-mapper` | `lib/*.mjs` + matching `lib/*.d.mts`. The return type is bb's `CreateThreadEnvironmentArgs`, which is **not exported** by name from `@get-bb/plugin-sdk/app` (it is a local `type` alias over an unexported zod schema, `bb-plugin-sdk-app.d.ts:368`). So the `.d.mts` must **index into** the SDK's own export rather than import the name — the spec already requires this, and the SDK declaration file is the reason |
| `form-extractions` | Required by the budget gate, not optional. Both functions are at ceiling, so `source-debt.json` must be edited in the same commit to add the two extracted functions and lower the two ceilings; `tests/debt-baseline.test.mjs` fails the build otherwise |
| `env-kind-control` | New `.tsx` under `components/settings/`. Must import the shared words from `components/isolated-worktree-check.tsx` (`ISOLATED_WORKTREE_LABEL` `:8`, `ISOLATED_WORKTREE_BENEFIT` `:9`) rather than re-declare them. Styling is plain Tailwind utility classes in JSX — there is no local Tailwind config to register anything, because the host compiles the CSS |
| `preset-list-indicator` | Reuses `Pill` from `components/dashboard/build-status-pills` (already imported at `preset-manager-list.tsx:1`). Must render **outside** the `truncate` span at `:41` or it will never be visible |
| `composer-seed-wiring` | `experimental_NewThreadComposer`'s `defaultEnvironment?: CreateThreadEnvironmentArgs` (`bb-plugin-sdk-app.d.ts:2667`). Three dialog prop types widen (`create-build-dialog.tsx:134`, `create-research-dialog.tsx:110`, `create-explore-dialog.tsx:110`). The SDK's documented re-seed rule ("value-compared each render … re-seeds EVERY execution and environment selection") is why the seed must be a module-level frozen constant, not a per-render literal |
| `features-doc-truth` | `FEATURES.md:1012-1013` and `:1206-1207`, plus five echoed copy sites (`github-issue-flow.ts:213,232`, `github-rule-rpcs.ts:91`, `lib/github-automation-gate.mjs:34`, `github-automation-tab.tsx:76`). Two of those strings are pinned by `tests/server-github-issue-flow.test.mjs:108,127`, so the docs change and the pins move together |
| `behaviour-tests` | `tests/*.mjs` on `node:test`. The existing exact-args pin at `tests/component-rule-seams.test.mjs:184-190` already asserts `environmentKind` and is wired into `npm run test:contracts` → `npm test`; `tests/suite-wiring.test.mjs` fails the build on any unwired test file. `tests/card-start.test.mjs:150` already pins the shared isolated-worktree toggle |

## 5. Vocabulary the stack fixes, verified against source

This is the finding that shapes every scope, so it is recorded with the lines that
prove it rather than as a claim:

- Stelow's stored `project-default` means **the shared checkout**:
  `server/workers.ts:99-101` returns `{ type: "host", workspace: { type: "unmanaged", path } }`.
- A worktree preset reaches bb as `{ type: "project-default" }` (`server/workers.ts:103`), and bb
  resolves that to **a managed worktree** when git permits.
- `lib/tracks.mjs:94-100` (`describeCardEnvironment`) returns `managed` for *any*
  `project-default` and reaches `worktree` only for `host` + `managed-worktree`. So the
  same card gets a different stored label depending on which path created it — a
  **permanent per-path divergence**, not a one-time flip.
- The SDK documents the same inversion from the other side: `defaultEnvironment` seeded with
  `{ type: "project-default" }` *"seeds nothing; the composer resolves its own default and
  submits that concrete environment instead."*

A control labelled "Project checkout vs Worktree" over the raw enum therefore cannot keep its
promise for one of its two states. The selected interface (`interfaces/selected-interface.md`,
`opt-3`) resolves this by making the OFF state silent — an on/off toggle that promises only
"Isolated worktree: on".

## 6. Build / verification commands available for this stage

```bash
npm run typecheck        # tsc --noEmit, strict, skipLibCheck:false
npm run lint             # oxlint
npm run quality:shape    # check-source-shape.mjs + check-source-budgets.mjs  ← the debt gate
npm run architecture     # dependency-cruiser: cycles, lib-is-host-neutral, no-slice→composition-root
npm test                 # 334 node:test files, incl. suite-wiring.test.mjs
npm run build:reload     # bb plugin build + reload stelow (verify the bundle, not the reload string)
npm run security:production
```

## 7. Alternatives considered and rejected

- **Ask the user to confirm the stack.** Rejected by the skill: `STACK_SOURCE` is set, so the
  stack is inferred and no question is asked. Review mode is `Auto` with `review_gates: []`,
  so there is no human gate to park it on either.
- **Adopt a newer styling/runtime stack (Tailwind as a direct dependency, a test framework,
  a component library).** Rejected on evidence, not taste: `tailwindcss` is absent from
  `package.json` by design because the host compiles `dist/app.css`; `node:test` is what
  `tests/suite-wiring.test.mjs` and all 334 files already run on; and `components/ui/` is a
  curated set of 18 primitives, not a generated shadcn tree. Adding any of the three would
  fork the host contract rather than fit it. The spec's own `tech_hints` say the same:
  *no new dependency, no new storage, no server contract change*.
- **Put the seed mapping in `components/` and skip `lib/`.** Rejected: it would make the
  mapping un-unit-testable without mounting React, and the dependency-cruiser rule
  `lib-stays-host-neutral` is the reason `lib/` exists as the pure tier.

## 8. Hand-off (workflow mode)

```
stage          : planning
description    : Tech planning. Typed scopes + sequencing.
status         : partial
artifacts      : runs/exec_nyrqy19d/plans/stack-research.md
next-candidate : plan-gate
gate           : none
rework-on      : scope
```

**Status is `partial` by design, and only because this task is one slice of the stage.**
This run covered `tech:5 — Discover Stack`. The remaining planning work — scope generation
with task tables, the bidirectional alignment check, the AI-aware testing strategy
(`product_type: software` activates it), and the `spec-tech` review gate — is not part of the
`planning-stack` task and has not been produced here. No state file, gate, or completion
record was modified by this run.
