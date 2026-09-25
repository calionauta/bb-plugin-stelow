import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  root,
  server,
  serverRecovery,
  serverInbox,
  serverWorkerRetry,
  cardsPersist,
  app,
  navigation,
  trackLists,
  boardCards,
  openStelowAction,
  routeAdapters,
  assignDialog,
  researchDetail,
  researchContent,
  researchState,
  exploreDetail,
  exploreContent,
  exploreState,
  exploreQuality,
  buildLifecycleState,
  buildLifecycleDialogs,
  buildDetail,
  buildContent,
  buildHero,
  buildProgressView,
  buildReviewTools,
  buildWorkspace,
  detailQuestions,
  buildProgress,
  detailSource,
  buildStatusPills,
  conversation,
  cardConversation,
  workerHistory,
  drafting,
  disclosureModule,
  artifactModule,
  creationModule,
  strategyPickerModule,
  manageMenu,
  manageRecovery,
  detailBanner,
  detailPresentation,
  detailInputFiles,
  detailHero,
  detailHeroActions,
  detailComment,
  detailTimeline,
  researchQuality,
  researchDialogs,
  detailScopes,
  detailViewer,
  manageHeader,
  rpcMethod,
} from "./card-lifecycle-contract.fixtures.mjs";

// Stepper composition: one selection hook drives dots, options, and
// submit; heading and option list render through dedicated units.
assert.match(
  conversation,
  /const sel = useBatchSelection\(questions\)/,
  "dots, options, and submit read one selection state",
);
assert.match(
  conversation,
  /<BatchQuestionHeading questions=\{questions\}/,
  "the heading renders through one unit",
);
assert.match(
  conversation,
  /<BatchOptionList current=\{current\}/,
  "options render through one list",
);
assert.match(
  conversation,
  /if \(!has\) setCustom\(\(c\) => \(\{\s*\.\.\.c, \[question\.id\]: ""\s*\}\)\)/,
  "single-select keeps option and custom text mutually exclusive",
);
// Agent thread: one shared conversation component across detail bodies —
// history plus compose box — never a per-track copy.
assert.match(
  cardConversation,
  /export function CardConversation\(\{ comments, draft, onDraftChange, onSend/,
  "the agent thread lives in the conversation module",
);
assert.match(
  detailSource,
  /import \{ CardConversation \} from/,
  "detail bodies read the shared thread",
);
assert.doesNotMatch(
  detailSource,
  /function CardConversation\(/,
  "no local thread copy survives in the detail slice",
);
assert.match(
  cardConversation,
  /disabled=\{!draft\.trim\(\)\} onClick=\{\(\) => onSend\(\)\}>Send to agent/,
  "empty drafts cannot send",
);
assert.match(
  cardConversation,
  /event\.metaKey \|\| event\.ctrlKey/,
  "keyboard send rides Cmd/Ctrl+Enter",
);

assert.doesNotMatch(
  openStelowAction,
  /min-h-11/,
  "the thread-header button never forces bar height in a stretching host slot",
);
assert.match(
  server,
  /hasRecoveryCheckout[\s\S]*fileEnvironmentId\s*=\s*!hasRecoveryCheckout/,
  "recovered exploratory cards use a host file target instead of a stale worker environment",
);
// One progress section, one artifact home, one reference. The doc buttons that
// duplicated Artifacts are gone, counts are counts, and the reference map is a
// sibling of the progress section rather than nested inside card state.
assert.match(
  disclosureModule,
  /function DisclosureSection\(\{ title, subtitle, hint/,
  "a section can name its job on its own line",
);
assert.doesNotMatch(
  detailSource,
  /onShowArtifacts/,
  "the per-stage document buttons are gone; files and navigation never share one shape",
);
assert.doesNotMatch(
  detailSource,
  /workflow\.progressTitle/,
  "the progress block no longer repeats the disclosure title it sits under",
);
assert.doesNotMatch(
  detailSource,
  /Agent advances alone/,
  "the override coaching stops being permanent chrome",
);
const progressSection = buildContent.slice(
  buildContent.indexOf("<BuildProgressSection"),
  buildContent.indexOf("<BuildArtifacts"),
);
assert.ok(
  progressSection.length > 0 &&
    progressSection.indexOf("<BuildProgressSection") <
      progressSection.indexOf("<WorkflowMap"),
  "the workflow map is a sibling of extracted progress, never nested inside it",
);
assert.match(
  readFileSync(join(root, "components", "detail", "workflow-map.tsx"), "utf8"),
  /export function WorkflowMap\(\{ open, onToggle/,
  "the map lives in the detail module",
);
assert.doesNotMatch(
  detailSource,
  /function WorkflowMap\(/,
  "no local map copy survives in the detail slice",
);
assert.doesNotMatch(
  app,
  /Fresh card — still in triage/,
  "no Draft pill duplicates the triage column",
);

// Finished work is not blocked work. The review signal is its own quieter
// treatment, derived from ONE predicate, and it is the completion's read state
// — never the amber attention flag the Inbox badge and attention filter count.
assert.match(
  boardCards,
  /cardNeedsReview\(card\)/,
  "board surfaces share the tested review predicate",
);
assert.match(
  trackLists,
  /pendingReview\(card\) \? <ReviewChip/,
  "list rows only ask for review through the shared completion predicate",
);
assert.match(
  server,
  /hasPendingReview: hasPendingReview\(deps\.db, row\.id\)/,
  "list rows carry the review signal from the shared Inbox helper",
);
assert.match(
  server,
  /hasPendingReview\(db, cardId\)/,
  "card detail carries the same review signal",
);
assert.match(
  server,
  /current\.kind\s*===\s*"build"\s*&&\s*!opts\?\.suppressCompletionEvent/,
  "exactly one completion notification per finished Build card",
);

// Two receipts, one word apart. Only their freshness tells them apart, so the
// card asks the owning helper for that verdict and labels both where they list.
assert.match(
  artifactModule,
  /rpc\.call\("auditTrailStatus", \{ cardId \}\)/,
  "freshness comes from the host, never guessed in the UI",
);
assert.match(
  buildProgressView,
  /card\.status === "completed" \? <AuditTrailStatusRow cardId=\{card\.id\} \/> : null/,
  "the freshness row appears only where a receipt can exist",
);
// Artifact surfaces: one shared inventory renderer plus the audit-trail
// freshness row — grouping sums through lib, the row re-checks on demand.
assert.match(
  artifactModule,
  /export function ArtifactInventory\(\{ groups, workspaceKind, fileEnvironmentId, onView/,
  "the inventory lives in the artifacts module",
);
assert.match(
  artifactModule,
  /export function AuditTrailStatusRow\(\{ cardId \}/,
  "the freshness row lives in the artifacts module",
);
assert.match(
  buildProgressView,
  /import \{\s*ArtifactGroups,\s*AuditTrailStatusRow,\s*artifactGroupTitle,/s,
  "Build progress and artifacts read the shared artifact surfaces",
);
assert.match(
  buildHero,
  /import \{ DetailQuestionSections \} from/,
  "Build review questions delegate artifact opening to the shared detail section",
);
assert.match(
  researchContent,
  /import \{ ArtifactInventory, type ArtifactInventoryGroup \} from "\.\.\/artifacts\/artifact-inventory"/,
  "Research reads the shared artifact inventory",
);
assert.doesNotMatch(
  detailSource,
  /function ArtifactInventory\(/,
  "no local inventory copy survives in the detail slice",
);
assert.doesNotMatch(
  detailSource,
  /function AuditTrailStatusRow\(/,
  "no local freshness-row copy survives in the detail slice",
);
assert.match(
  artifactModule,
  /groupArtifactsByStage\(artifacts\)/,
  "stage grouping sums through the lib, never inline math",
);
