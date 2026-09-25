import assert from "node:assert/strict";
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

// The viewer is shared by every detail track. It owns both live file reads and
// the quote-to-card-comment flow; a local copy would strand draft resets or RPC
// routing even when TypeScript still accepted the three call sites.
assert.match(
  detailSource,
  /import \{ ArtifactViewerDialog \} from/,
  "detail bodies share one artifact viewer",
);
assert.equal(
  (detailSource.match(/<ArtifactViewerDialog/g) ?? []).length,
  3,
  "Build, Research, and Explore mount the same viewer",
);
assert.doesNotMatch(
  detailSource,
  /function ArtifactViewerDialog\(/,
  "no local viewer copy survives in the detail slice",
);
assert.match(
  detailViewer,
  /rpc\.call\("readCardFile", \{ cardId, path: file\.path \}\)/,
  "the viewer reads the selected card file through the host",
);
assert.match(
  detailViewer,
  /rpc\.call\("addCardComment", \{ cardId, target: "card", targetId: cardId, body: commentBody\(file, drafts\) \}\)/,
  "quoted excerpts post to the card worker as one comment",
);
assert.match(
  detailViewer,
  /if \(open && file\) setDrafts\(\[\]\)/,
  "opening or changing the file clears excerpts from the previous file",
);
assert.match(
  detailViewer,
  /\(no note — for context\)/,
  "an excerpt without a note still sends honest context",
);
// Review checkpoints: bulk actions and one-click templates write into the
// same multi-select state as the checkboxes — shortcuts, never a second
// model; rows render through one shared row.
assert.match(
  creationModule,
  /<ReviewGateBulkActions onChange=\{onChange\} \/>/,
  "select-all and clear share the picker state",
);
assert.match(
  creationModule,
  /<ReviewGateTemplates onPick=\{onChange\} \/>/,
  "templates write into the picker state",
);
assert.match(
  creationModule,
  /onClick=\{\(\) => onPick\(\[\.\.\.preset\.gates\]\)\}/,
  "a template replaces the selection, never appends",
);
assert.match(
  creationModule,
  /<ReviewGateOptionRow key=\{option\.value\} option=\{option\} selected=\{value\.includes\(option\.value\)\} groupName=\{groupName\} onToggle=\{toggle\} \/>/,
  "options render through one shared row",
);
// Strategy picker: search narrows across identity, label, blurb, and
// keywords; results delegate rows; the attention signal drives the flash.
assert.match(
  strategyPickerModule,
  /strategies\.filter\(\(entry\) => \[entry\.id, entry\.label, entry\.blurb, \.\.\.entry\.keywords\]/,
  "search narrows the list, never just filters it",
);
assert.match(
  strategyPickerModule,
  /<StrategyOptionRow key=\{entry\.id\} entry=\{entry\} selected=\{value === entry\.id\}/,
  "options render through one shared row",
);
assert.match(
  strategyPickerModule,
  /<StrategyResults visible=\{visible\}/,
  "the shell composes search, count, and results",
);
assert.match(
  strategyPickerModule,
  /const flash = useAttentionFlash\(attentionSignal, searchRef\)/,
  "the attention signal drives search focus and flash",
);
assert.match(
  buildDetail,
  /if \(card\?\.status === "completed"\) setArtifactsOpen\(true\)/,
  "a completed card opens its evidence instead of hiding it",
);
assert.match(
  server,
  /const isTrail = basename\(absolute\) === AUDIT_TRAIL_FILE;/,
  "the host recognizes the portable receipt by the name Stelow owns",
);
assert.match(
  server,
  /stage: isTrail \? "audit" : "unregistered"/,
  "the portable receipt is attributed to the stage that produced it",
);
assert.match(
  server,
  /note: auditReceiptNote\(/,
  "both receipts are labelled where they are listed",
);
assert.match(
  server,
  /auditTrailGate\(\{\s*build: trail,\s*check: trailCheck,\s*verifiedGit: gitEvidence,?\s*\}\)/,
  "the trail is bound to the Git identity the audit receipt was verified at",
);
assert.match(
  server,
  /sameGitEvidence\(gitEvidence, postTrailGitEvidence\)/,
  "Done re-samples Git after the portable receipt validates",
);
assert.match(
  server,
  /\["audit-trail", "check", "--strict", "--json"\]/,
  "the post-completion status uses the same strict receipt contract as Done",
);
assert.match(
  server,
  /recon: await reconStatus\(/,
  "the host derives reconnaissance evidence from the portable receipt, never UI state",
);
assert.match(
  server,
  /RECON_RECEIPT_FILE/,
  "the reconnaissance receipt path is one shared contract",
);

// Every path into completed records the done trail event: the explicit
// done command, both quiet auto-complete sweeps, and manual moves into
// Done. A Done-column card without one is invisible to flow metrics —
// that was the whole "N finished vs N in Done" confusion.
//
// The two quiet auto-completions (research, explore) no longer each carry
// their own line: they share one completion writer, so the trail cannot
// drift between them. tests/runtime-research-track-sync.test.mjs asserts
// executably that BOTH tracks reach it; this pin only keeps the count at
// one shared site.
assert.equal(
  (server.match(/recordStageEvent\(card\.id, "done"\)/g) ?? []).length,
  1,
  "the quiet auto-completions share one done-trail writer",
);
assert.match(
  server,
  /if\s*\(status\s*===\s*"completed"\)\s*deps\.recordStageEvent\(cardId,\s*"done"\)/,
  "manual moves into Done record the done event",
);

console.log(
  "card lifecycle contract test ok: UI and RPC keep card lifecycle semantics aligned",
);
