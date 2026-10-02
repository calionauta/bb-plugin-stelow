import assert from "node:assert/strict";
import { codeOf } from "./helpers/source-code.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  root,
  server,
  app,
  trackLists,
  boardCards,
  openStelowAction,
  researchContent,
  buildContent,
  buildHero,
  buildProgressView,
  detailSource,
  conversation,
  answerBody,
  cardConversation,
  disclosureModule,
  artifactModule,
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
// The list renders through one unit, and that unit now receives the
// boundary-filtered options (`shown`) rather than the raw question: a reaction
// boundary withholds its options there, once, instead of at every read.
assert.match(
  answerBody,
  /<BatchOptionList[\s\S]{0,40}current=\{shown\}/,
  "options render through one list, fed the boundary-filtered options",
);
assert.match(
  answerBody,
  /const shown: BatchItem = \{ \.\.\.current, options: boundaryOptions\(current\) \};/,
  "the boundary decides the option list in one place",
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
// Whitespace-tolerant, and pinned on the BEHAVIOUR rather than the label. The
// old regex also matched the literal string "Send to agent", so renaming the
// section to what it actually is — a note, not a live conversation — went red
// here with nothing about the behaviour having changed.
assert.match(
  cardConversation,
  /disabled=\{!draft\.trim\(\)\}\s*onClick=\{\(\) => onSend\(\)\}\s*>\s*Leave note/,
  "empty drafts cannot send",
);
assert.match(
  cardConversation,
  /event\.metaKey \|\| event\.ctrlKey/,
  "keyboard send rides Cmd/Ctrl+Enter",
);
// The thread is the real conversation, so it must be reachable from the section
// HEADER — a reader should not have to expand a section of notes to find the
// way to the place where talking to the agent actually happens.
assert.match(
  cardConversation,
  /action=\{threadId \? <OpenThreadButton threadId=\{threadId\} \/> : null\}/,
  "the thread affordance belongs in the header, not below the composer",
);
// And the section must not claim to be a conversation it is not: addCardComment
// writes to the card log, which the worker reads on its next poll.
assert.doesNotMatch(
  codeOf(cardConversation),
  /title="Conversation"|talk to the agent|Send to agent|Write to the agent/,
  "the section promised a live channel and had none; a name that overstates a feature is a bug",
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
      progressSection.indexOf("<StageSection"),
  "the stage section is a sibling of extracted progress, never nested inside it — the original rule, "
    + "re-pinned from <WorkflowMap when the timeline, runs and stage reference merged into one "
    + "section. The reasoning is unchanged: progress owns where the WORK is, the stage section owns "
    + "where the card IS, and nesting one inside the other would make a reader scroll a scope list "
    + "to find out which stage the card is on",
);
assert.match(
  readFileSync(join(root, "components", "detail", "stage-section.tsx"), "utf8"),
  /function StageReference\(\{ open, onToggle/,
  "the stage reference lives in the stage section — it absorbed workflow-map.tsx when the map, the "
    + "timeline and the run history became one section",
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
  /if \(current\.kind !== "build" \|\| options\?\.suppressCompletionEvent\) return;/,
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
  /groupArtifactsByStage\(deliverables\)/,
  // Grouping sums through the lib, never inline math — over the deliverables
  // rather than the raw prop. Grouping the raw list is what put a machine
  // receipt in a stage bucket and in the deliverables count at once.
  "stage grouping sums through the lib, over the role-partitioned deliverables",
);
