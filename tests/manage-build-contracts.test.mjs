import assert from "node:assert/strict";
import {
  server,
  app,
  routeAdapters,
  buildLifecycleState,
  buildLifecycleDialogs,
  buildDetail,
  buildContent,
  detailSource,
  workerHistory,
  manageMenu,
  manageHeader,
} from "./card-lifecycle-contract.fixtures.mjs";

// Manage surfaces: menu, header, and confirm live in one home; the panel
// reads them, never pastes them. Picking a menu entry closes the menu
// before the action runs.
assert.match(
  manageMenu,
  /export function CardActionsMenu\(\{ card, onRestartFresh, onArchive, onDiscard, onDelete, onReclassify/,
  "the menu lives in the manage module",
);
assert.match(
  manageHeader,
  /export function CardDetailHeader\(\{ card, onBack, onRestartFresh, onArchive, onDiscard, onDelete, onReclassify, statusTone, intentLabel/,
  "the header lives in the manage module",
);
assert.match(
  buildDetail,
  /import \{ CardDetailHeader \} from "\.\.\/manage\/card-detail-header"/,
  "Build detail reads the shared header",
);
assert.match(
  detailSource,
  new RegExp(
    "import \\{ ConfirmActionDialog \\} from \"\\.\\./manage/confirm-action-dialog\""
      + "|import \\{ ConfirmActionDialog \\} from "
      + "\"\\./components/manage/confirm-action-dialog\"",
  ),
  "detail bodies read the shared confirm",
);
assert.doesNotMatch(
  detailSource,
  /function CardActionsMenu\(/,
  "no local menu copy survives in the detail slice",
);
assert.doesNotMatch(
  detailSource,
  /function CardDetailHeader\(/,
  "no local header copy survives in the detail slice",
);
assert.doesNotMatch(
  detailSource,
  /function ConfirmActionDialog\(/,
  "no local confirm copy survives in the detail slice",
);
assert.match(
  manageMenu,
  /onPick=\{\(action\) => \{ setOpen\(false\); action\(\); \}\}/,
  "picking closes the menu before running",
);

assert.doesNotMatch(
  workerHistory,
  /Archive card|Delete permanently|Restart fresh/,
  "Worker contains worker context only, never card lifecycle actions",
);

// Archived is terminal: the single updateCard choke point strips
// resuscitations, worker-thread events never reach archived cards, and the
// Archive button honors a refused archive instead of celebrating it.
assert.match(
  server,
  /stripArchivedResuscitation\(\s*previous\?\.status,\s*fields as/,
  "every status write passes the archived-terminal rule",
);
assert.match(
  server,
  /SELECT id FROM cards WHERE worker_thread_id = \? AND status != 'archived'/,
  "thread events never sync archived cards",
);
// Build lifecycle state is cohesive and has one owned RPC seam per action.
// The tested policy module decides outcomes; the hook owns React state and
// the dialog component owns only confirmations. Copying any path back into
// app.tsx would let its toast/close/refresh semantics drift independently.
assert.match(
  buildDetail,
  /import \{ useBuildDetailLifecycle \} from "\.\/use-build-detail-lifecycle"/,
  "Build detail mounts the extracted lifecycle state",
);
assert.match(
  buildDetail,
  /import \{ BuildLifecycleDialogs \} from "\.\/build-lifecycle-dialogs"/,
  "Build detail mounts the extracted lifecycle dialogs",
);
const lifecycleDialogCall =
  /<BuildLifecycleDialogs[\s\S]*state=\{lifecycle\}[\s\S]*cardDisplayName=\{card\?\.displayName \?\? null\}/;
assert.match(
  buildDetail,
  lifecycleDialogCall,
  "the extracted dialog leaf receives the complete lifecycle state",
);
const privateLifecycleAction = new RegExp(
  "async function (?:doArchive|doDelete|openDiscard|doDiscard|doPromote|" +
    "doAttachRecoveryCheckout|doCreateRecoveryAudit|doRepair|doRetry|" +
    "doRestartWorker|doStart|doRequestSplit)\\(",
);
assert.doesNotMatch(
  detailSource,
  privateLifecycleAction,
  "no Build lifecycle action remains private to the detail slice",
);
assert.match(
  routeAdapters,
  /import \{ BuildDetailBody \} from "\.\/build-detail-body"/,
  "the routes mount the extracted Build detail shell",
);
assert.equal(
  (routeAdapters.match(/<BuildDetailBody/g) ?? []).length,
  2,
  "panel and drawer routes share one Build detail shell",
);
assert.doesNotMatch(
  app,
  /function CardDetailBody\(/,
  "the old Build detail implementation is completely removed from app.tsx",
);
const detailRealtime =
  /useDebouncedRealtime\(\["card-state", "inbox-changed"\], \(\) => void load\(\)\)/;
assert.match(
  buildDetail,
  detailRealtime,
  "the extracted shell keeps debounced card and inbox refreshes",
);
const closesAdvancePreview =
  /const confirm = \(\) => \{\s*if \(!pendingAdvance\) return;\s*onOpenChange\(false\);\s*void onAdvance\(pendingAdvance\);/;
assert.match(
  buildDetail,
  closesAdvancePreview,
  "confirming an advance closes the preview before the async transition starts",
);
const buildOrder = buildContent.slice(
  buildContent.indexOf("<BuildReviewHero"),
  buildContent.indexOf("<CardConversation"),
);
assert.ok(
  buildOrder.indexOf("<BuildProgressSection") <
    buildOrder.indexOf("<WorkflowMap") &&
    buildOrder.indexOf("<WorkflowMap") < buildOrder.indexOf("<BuildArtifacts"),
  "progress, workflow map, and artifacts keep their established detail order",
);
for (const rpc of [
  "cancelCard",
  "deleteCard",
  "discardPreview",
  "discardCardChanges",
  "promoteCard",
  "attachRecoveryCheckout",
  "createRecoveryAudit",
  "reseedCard",
  "retryWorker",
  "restartWorker",
  "startWorker",
  "requestSplitProposal",
]) {
  assert.equal(
    (buildLifecycleState.match(new RegExp(`rpc\\.call\\("${rpc}"`, "g")) ?? [])
      .length,
    1,
    `Build lifecycle has one ${rpc} seam`,
  );
}
assert.equal(
  (buildLifecycleDialogs.match(/<ConfirmActionDialog/g) ?? []).length,
  6,
  "the lifecycle dialog leaf owns repair, restart, archive, delete, discard, and recovery confirmation",
);
assert.match(
  buildLifecycleDialogs,
  /<Dialog open=\{state\.promoteOpen\}/,
  "promotion keeps its named-project dialog in the lifecycle leaf",
);
