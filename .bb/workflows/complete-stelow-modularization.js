export const meta = {
  name: "complete-stelow-modularization",
  description: "Finish every remaining app and server modularization slice with tests, review, fixes, commits, and pushes",
  phases: [
    { title: "Implement", detail: "One sequential worker implements and commits each bounded slice" },
    { title: "Review", detail: "A fresh worker double-checks behavior, tests, and architecture" },
    { title: "Finalize", detail: "A fresh worker closes gaps, runs all gates, commits, and pushes" },
    { title: "Audit", detail: "A completeness critic checks every original target" },
    { title: "Repair", detail: "Fresh workers repair omissions and re-audit until clean" },
    { title: "Report", detail: "Synthesize the final verified result" },
  ],
};

const slices = [
  {
    id: "build-lifecycle-state",
    goal: "Extract Build CardDetailBody state and lifecycle actions (archive/delete/discard/promote/recovery/repair/retry/restart/start/split) into cohesive detail modules with behavior tests and no behavior change.",
  },
  {
    id: "build-progress-check-quality",
    goal: "Extract Build progress, timeline, scopes, card checks, gaps, quality, and their loading/presentation into cohesive components. Keep file <=400 and functions <=50.",
  },
  {
    id: "build-publication",
    goal: "Extract Build publication status/actions/commit UI from CardDetailBody into a publication feature module, preserving partial-failure and refresh semantics.",
  },
  {
    id: "build-diff",
    goal: "Extract Build diff and commit inspection from CardDetailBody into a diff feature module, preserving entity summaries, changed symbols, file disclosure, and commit navigation.",
  },
  {
    id: "build-recovery",
    goal: "Extract Build workspace recovery presentation/actions from CardDetailBody into a recovery feature module, preserving promote, attach, audit, evidence, and confirmation behavior.",
  },
  {
    id: "build-body-shell",
    goal: "Move the remaining Build CardDetailBody shell to components/detail/build-detail-body.tsx and split any remaining render blocks/dialogs until all functions <=50 and files <=400. Remove the old implementation completely.",
  },
  {
    id: "route-parsing-tab-panel",
    goal: "Extract parseStelowSubPath, StelowTabBar, and StelowPanel into a panel/router feature with route tests and no app.tsx cycles.",
  },
  {
    id: "detail-route-adapters",
    goal: "Extract StelowCardDetail, BareCardRoute, and CardDrawerAdapter together with their route/slot tests.",
  },
  {
    id: "question-form",
    goal: "Extract QuestionForm and pending-interaction wiring into components/conversation with keyboard/submit/cancel behavior tests.",
  },
  {
    id: "message-directives",
    goal: "Extract OpenStelowAction, StelowQualityDirective, StelowArtifactDirective, and related styling/wiring into focused modules with malformed-attribute and dead-link tests.",
  },
  {
    id: "board-filters-views",
    goal: "Extract FiltersBar, FilterMultiSelect, ViewToggle, and Research/Explore/Build list adapters into components/board with behavior and view-restriction tests.",
  },
  {
    id: "board-cards-columns",
    goal: "Extract BoardColumn, BoardCard, LightweightTrackCard, ResearchCard, ExploreCard, CardHeading, CardMetaRows, CardRetryButton, and card attention/review helpers into focused board modules.",
  },
  {
    id: "board-gallery",
    goal: "Extract CardGalleryDialog, bucket gallery copy, hook, and button as one board/card-gallery feature with kanban-layout and hill-view topology tests.",
  },
  {
    id: "board-hill-flow",
    goal: "Extract hillRegionLabel, HillBoard, FlowStrip, and hill/list presentation into components/board with flow metrics and hill math tests.",
  },
  {
    id: "panel-state-hooks",
    goal: "Extract shared board view/collapsed state and panel data-loading hooks from BoardPanel, ResearchPanel, ExplorePanel, and InboxPanel without moving the panel shells yet.",
  },
  {
    id: "inbox-panel",
    goal: "Extract InboxPanel into components/panels with read/archive/restore/filter/badge behavior and failure-state tests.",
  },
  {
    id: "build-panel",
    goal: "Extract BuildPanel into components/panels and compose it from extracted board, gallery, filters, cards, dialogs, and state hooks.",
  },
  {
    id: "research-panel",
    goal: "Extract ResearchPanel into components/panels with project switching, strategy labels, view modes, and creation/preset dialog wiring.",
  },
  {
    id: "explore-panel",
    goal: "Extract ExplorePanel into components/panels with technique labels, view modes, and creation/preset dialog wiring.",
  },
  {
    id: "settings-onboarding",
    goal: "Extract onboardingTotal, PresetOnboardingBody/Footer/Dialog into components/settings with first/last step, reset, storage, and preset-manager tests.",
  },
  {
    id: "settings-preset-picker",
    goal: "Extract asPresetReasoningLevel, PresetExecutionPicker, and modeLabel into components/settings with host-picker and normalization tests.",
  },
  {
    id: "settings-decision-api",
    goal: "Extract DecisionApiSection, DecisionRouterRow, and DecisionRoutersSection into components/settings and re-home decision-routers pins without weakening them.",
  },
  {
    id: "settings-preset-manager",
    goal: "Split and extract PresetManagerDialog into shell/list/form/band-routing modules, preserving bounded modal, mobile fullscreen, ordering, scroll/focus, create/edit/delete/apply behavior.",
  },
  {
    id: "settings-preset-assign-recovery",
    goal: "Extract PresetAssignDialog and WorkspaceRecoveryPanel into focused components; remove renderer injection from Research/Explore when safe.",
  },
  {
    id: "settings-host-about-update",
    goal: "Extract HostToolsSection, PluginUpdateStatus, AboutPanel, and their state/update presentation into focused modules with update lifecycle and tool status tests.",
  },
  {
    id: "app-support-helpers",
    goal: "Relocate remaining app-local route, status, realtime, plugin-update, formatting, and state helpers to owned lib/hook/component modules. Ensure app.tsx is <=600 lines without dead compatibility shims.",
  },
  {
    id: "server-decision-api",
    goal: "Extract Decision API RPCs, review policy, migrations, handlers, and seams into server/decision-api.ts using the github-issues factory pattern. Re-home and strengthen decision tests.",
  },
  {
    id: "server-scopes",
    goal: "Extract scope read helpers, workflowScopes, and scope CLI into server/scopes.ts without importing upward; preserve scope command/order/fingerprint/sync behavior.",
  },
  {
    id: "server-inbox",
    goal: "Extract inbox notification RPCs, inbox migrations, resolve/reopen/read/archive semantics into server/inbox.ts and preserve badge/severity/history behavior.",
  },
  {
    id: "server-artifacts-publication",
    goal: "Extract all publication RPCs, migrations, status/commit/diff/push/squash/PR behavior into server/artifacts-publication.ts and dissolve the server publication clone.",
  },
  {
    id: "server-workspaces-recovery",
    goal: "Extract workspaceRecovery, attachRecoveryCheckout, createRecoveryAudit, migrations, and workspace dependencies into server/workspaces-recovery.ts.",
  },
  {
    id: "server-workers",
    goal: "Extract worker spawn/start/stop/retry/restart, fresh worker, environment selection, card thread ledger, history, retry claims, migrations, and scheduler dependencies into server/workers.ts.",
  },
  {
    id: "server-drafting",
    goal: "Extract CLI drafting/generation burst and preset/environment/card cascade into server/drafting.ts with draft-burst and reliability tests.",
  },
  {
    id: "server-card-read-create",
    goal: "Extract card board/list/read, createCardInternal, project/card workspace resolution, and related helpers into server/cards.ts while preserving existing server cards behavior.",
  },
  {
    id: "server-card-lifecycle",
    goal: "Extract card detail, comment, move, archive/delete/discard, advance, split, promote, and lifecycle handlers into server/cards.ts without duplicating the previous card slice.",
  },
  {
    id: "server-presets",
    goal: "Extract preset CRUD, generation/reliable/review/band presets, card assignment/default, DDL, and getPresetFor cascade into server/presets.ts; expose safe accessors for github-issues.ts.",
  },
  {
    id: "server-composition-root",
    goal: "Reduce server.ts to a small composition root <=600 lines: relocate bootstrap helpers, contract fragments, migrations, tool/update/preview/search/CLI composition, and eliminate upward imports/cycles.",
  },
  {
    id: "docs-blueprint",
    goal: "Update FEATURES/docs where user-facing behavior exists and propose/commit/push the matching upstream host-plugin blueprint edits for portable lib modules and feature-slice patterns. Do not invent feature entries for pure refactors.",
  },
  {
    id: "final-enforcement",
    goal: "Add practical enforcement for file/function budgets where it can be green without rejecting inherited legacy code; resolve or date the two remaining hook exceptions; run complete quality/security audit.",
  },
];

const common = `
You are the sole writer for a shared BB project checkout. Other workflow workers will run later, never concurrently with you.
Follow every repository AGENTS.md rule and the current coding standards. Work in the existing branch; never merge, rebase, reset, clean, or discard unrelated/user work. Never restart bb-daemon. Use one edit per file per parallel block. After a failed edit, verify with wc -l and git diff before continuing. Do not ask the user routine questions; make conservative decisions and continue.
LoC is a safety limit, never a formatting target: never compress JSX, chain unrelated expressions, pack declarations, or hide logic in long single-line JSX to hit a budget. Keep new JSX readable with one element/branch per line; treat changed source lines over 160 characters as a review failure unless they are unavoidable URLs, generated artifacts, or machine-readable fixtures. Inherited legacy violations must be reported, not copied into extracted files. Run the quality:shape command after edits and before committing; fix every violation in new or changed source.
The user requires useful regression tests, not snapshot/existence noise. For each slice: inspect and run relevant tests BEFORE editing, add behavior tests for uncovered behavior, adapt topology pins only to preserve their original intent, and negative-control at least one new critical guard. Then run typecheck, full npm test, architecture, duplicates, deadcode, lint, ripwire quality-delta/edit-check as applicable, and build:reload. Confirm the new code is present in dist. Use conventional commit messages (refactor for extraction, test/chore/fix/docs when appropriate) and push the green commit to the current branch. If a user-facing feature changed, update FEATURES.md in the same commit. Finish with a compact report: outcome, commit SHA, push result, tests/gates, files, remaining gap in this slice.
`;

const results = [];
let previous = "No previous slice.";

for (let index = 0; index < slices.length; index += 1) {
  const slice = slices[index];
  const label = `${String(index + 1).padStart(2, "0")}-${slice.id}`;
  phase("Implement");
  log(`Implementing ${label}: ${slice.goal}`);
  const implementation = await agent(`${common}\nSlice ${index + 1}/${slices.length}: ${slice.id}\nGoal: ${slice.goal}\nPrevious slice report: ${previous}\nStart by checking git status/log and the current tree. Complete exactly this slice; if it was already completed by earlier work, verify it and make no speculative duplicate.`, {
    label: `implement:${slice.id}`,
    phase: "Implement",
  });

  phase("Review");
  log(`Reviewing ${label}`);
  const review = await agent(`${common}\nFresh double-check for slice ${slice.id}.\nGoal: ${slice.goal}\nImplementation report: ${implementation}\nInspect the actual diff and latest commits, not the report alone. Re-run focused tests. Perform adversarial gap analysis for behavior drift, missing tests, stale pins, cycles, dead code, size/function budgets, and accidental scope expansion. Fix every real issue you find, adapt tests to guard behavior, run the full per-slice gates, commit/push any fixes, and return the verified result.`, {
    label: `review:${slice.id}`,
    phase: "Review",
  });

  phase("Finalize");
  log(`Finalizing ${label}`);
  const finalized = await agent(`${common}\nFinal gate for slice ${slice.id}.\nGoal: ${slice.goal}\nImplementation: ${implementation}\nReview: ${review}\nTreat both prior reports as untrusted summaries. Inspect repository state, run focused and full tests plus quality/build/bundle gates, fix anything still broken, commit/push if needed, and prove the slice is complete. Do not move to another slice.`, {
    label: `finalize:${slice.id}`,
    phase: "Finalize",
  });

  results.push({ id: slice.id, implementation, review, finalized });
  previous = finalized;
}

phase("Audit");
log("Running completeness audit against every original target");
const audit = await agent(`${common}\nYou are the final completeness critic for the entire modularization plan. Audit the repository against these original targets: app.tsx <=600, server.ts <=600, every new file <=400, functions <=50 or explicitly dated exceptions, no avoidable duplication/dead code/cycles, Build body extracted, router/panel/board/settings/directives extracted, all nine server slices extracted, docs/blueprint synchronized, full tests/security/quality/build green, and working tree clean. Inspect commits/diffs and run the final commands. Fix any small remaining issue directly. For anything too broad to fix safely, return precise next actions. Do not claim completion without evidence.`, {
  label: "completeness-audit",
  phase: "Audit",
  schema: {
    type: "object",
    required: ["complete", "findings", "nextActions", "evidence"],
    properties: {
      complete: { type: "boolean" },
      findings: { type: "array", items: { type: "string" } },
      nextActions: { type: "array", items: { type: "string" } },
      evidence: { type: "array", items: { type: "string" } },
      commit: { type: ["string", "null"] },
    },
  },
});

let finalAudit = audit;
for (let round = 1; round <= 3 && finalAudit && finalAudit.complete === false; round += 1) {
  phase("Repair");
  log(`Repair round ${round}: ${finalAudit.nextActions.length} action(s)`);
  const repair = await agent(`${common}\nCompleteness repair round ${round}. The final audit is not complete.\nFindings: ${JSON.stringify(finalAudit.findings)}\nRequired next actions: ${JSON.stringify(finalAudit.nextActions)}\nImplement the next actions as bounded safe slices, one at a time. For each: inspect existing tests, add/fix behavior tests, run focused and full gates, negative-control new guards, commit and push. Continue without asking routine questions. Return a precise report even if an external dependency blocks one action.`, {
    label: `repair-round-${round}`,
    phase: "Repair",
  });
  phase("Audit");
  const repairedAudit = await agent(`${common}\nRe-audit after repair round ${round}.\nRepair report: ${repair}\nRe-check every original completeness target, run all final gates, fix any small issue, and return structured evidence. Do not trust the repair report.`, {
    label: `reaudit-${round}`,
    phase: "Audit",
    schema: {
      type: "object",
      required: ["complete", "findings", "nextActions", "evidence"],
      properties: {
        complete: { type: "boolean" },
        findings: { type: "array", items: { type: "string" } },
        nextActions: { type: "array", items: { type: "string" } },
        evidence: { type: "array", items: { type: "string" } },
        commit: { type: ["string", "null"] },
      },
    },
  });
  finalAudit = repairedAudit;
}

phase("Report");
const report = await agent(`${common}\nProduce the final user-facing completion report from repository evidence and the workflow records below. Verify current git status/log, app/server line counts, all slice commit SHAs, test/quality/security/build results, and any genuine blockers. State clearly which targets are complete and what remains if the audit is not complete. Do not make more feature changes unless a tiny final-report correction is required.\nSlice records: ${JSON.stringify(results)}\nFinal audit: ${JSON.stringify(finalAudit)}`, {
  label: "final-report",
  phase: "Report",
});

return { slices: results, audit: finalAudit, report };
