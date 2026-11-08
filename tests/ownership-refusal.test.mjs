// The refusal sentence and the predicate that recognises it.
//
// These two are the same fact, and the drift they prevent is invisible: the
// words say "Reseed this card" while the button says "Restart fresh…", and the
// confirm dialog for that button advises trying Retry first. Nothing fails when
// that drifts — the reader just gets sent to a door they cannot find.
//
// So the tests here are narrow on purpose. They check that the predicate
// accepts the constant and the site's own tail, and that it rejects everything
// else — including a message that merely *contains* the phrase, which is the
// case a lazy `includes` would wave through and a client would then render the
// ownership copy for an unrelated error.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isOwnershipRefusal,
  ownershipRepairAdvice,
  OWNERSHIP_UNVERIFIED,
} from "../lib/ownership-refusal.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// The two words in the sentence are UI copy that lives in the components, so
// both halves are asserted where a reader would see them: the menu really
// renders the label the refusal names, and the repair dialog really reads the
// shared advice rather than choosing it inline. Rendering is what tells a live
// branch from a dead one — a text pin can only report that the words appear in
// the file. The other half — whether that action actually works on a card the
// refusal is written for — is `tests/reseed-unowned-door.test.mjs`, and it is
// the half that used to be missing.
import { register } from "node:module";
import { pathToFileURL } from "node:url";

globalThis.__bbPluginRuntime = { pluginSdkApp: { useRpc: () => ({ call: async () => ({}) }) } };
register(pathToFileURL(new URL("./register-tsx.mjs", import.meta.url).pathname), import.meta.url);
await import("./dom-setup.mjs");
const { createElement: h } = await import("react");
const { render, screen, fireEvent, cleanup } = await import("@testing-library/react");
const { CardActionsMenu } = await import("../components/manage/card-actions-menu.tsx");
const { BuildLifecycleDialogs } = await import("../components/detail/build-lifecycle-dialogs.tsx");

const noop = () => {};
const manageable = {
  id: "card_1",
  intent: "feature",
  displayName: "Checkout",
  name: "checkout",
  projectName: "Proj",
  kind: "build",
  stage: "execution",
  activity: "error",
  status: "in-progress",
  needsAttention: true,
};

// `activity: error` is what makes the restart-fresh entry recoverable, so this
// is the card the refusal is written for — a menu that dropped the entry would
// send the reader to a door that is not there.
render(h(CardActionsMenu, {
  card: manageable,
  onRestartFresh: noop,
  onArchive: noop,
  onDiscard: noop,
  onDelete: noop,
  onRestore: noop,
  onReclassify: async () => true,
}));
fireEvent.click(screen.getByRole("button", { name: "Card actions" }));
assert.ok(
  screen.getByRole("button", { name: "Restart fresh…" }),
  "the action the refusal names is a label the menu really renders",
);
cleanup();

const lifecycleState = (overrides = {}) => ({
  repairOpen: true,
  setRepairOpen: noop,
  doRepair: async () => {},
  restartWorkerOpen: false,
  setRestartWorkerOpen: noop,
  doRestartWorker: noop,
  recoveryAttachProjectId: null,
  setRecoveryAttachProjectId: noop,
  doAttachRecoveryCheckout: noop,
  archiveOpen: false,
  setArchiveOpen: noop,
  doArchive: noop,
  deleteOpen: false,
  setDeleteOpen: noop,
  doDelete: noop,
  discardOpen: false,
  setDiscardOpen: noop,
  discardConfirm: null,
  doDiscard: noop,
  restoreOpen: false,
  setRestoreOpen: noop,
  doRestore: noop,
  promoteOpen: false,
  setPromoteOpen: noop,
  promoteName: "",
  setPromoteName: noop,
  promoting: false,
  doPromote: noop,
  ...overrides,
});

function repairDialogFor(cardLastError) {
  render(h(BuildLifecycleDialogs, {
    state: lifecycleState(),
    cardDisplayName: "Checkout",
    cardStage: "execution",
    cardLastError,
  }));
  const body = document.body.textContent ?? "";
  cleanup();
  return body;
}

const ownershipCopy = repairDialogFor(OWNERSHIP_UNVERIFIED);
assert.match(ownershipCopy, /Retry cannot help here/, "an unowned card is told the cheaper action cannot work");
assert.doesNotMatch(ownershipCopy, /Try Retry first/, "and the ordinary advice is not left beside it");

const ordinaryCopy = repairDialogFor("Provider error 400 from the model endpoint.");
assert.match(ordinaryCopy, /Try Retry first/, "an ordinary failure keeps the ordinary advice");
assert.doesNotMatch(ordinaryCopy, /Retry cannot help here/, "the ownership advice is not re-spelled in the component");

assert.equal(
  isOwnershipRefusal(OWNERSHIP_UNVERIFIED),
  true,
  "the sentence recognises itself",
);
for (const notIt of [
  null,
  undefined,
  "",
  "Provider error 400 from the model endpoint.",
  "The worker thread did not accept the message.",
  // The phrase mid-sentence: a completion that happens to quote the refusal.
  "Build completion is blocked because the state records disagree (Workflow state ownership cannot be verified).",
  "  Workflow state ownership cannot be verified: indented copy.",
]) {
  assert.equal(
    isOwnershipRefusal(notIt),
    false,
    `not an ownership refusal: ${JSON.stringify(notIt)}`,
  );
}

// The wording itself is NOT pinned here. `assert.match(OWNERSHIP_UNVERIFIED, /Restart fresh…/)`
// proves only that a string contains some words, and it passes unchanged if the
// reseed path grows a `requireOwnedState` guard — the exact change that turns
// the sentence into a lie, and the one this file was written believing it
// caught. Whether the door the sentence names actually opens on an unowned card
// is `tests/reseed-unowned-door.test.mjs`, which runs the real reseed against a
// real workspace whose records genuinely disagree. What is left to assert here
// is the thing a string CAN prove: the sentence is a prefix the predicate
// accepts, so the surfaces downstream can recognise it without matching words
// they could have misspelled.
assert.equal(
  isOwnershipRefusal(`${OWNERSHIP_UNVERIFIED} Reseed this card before changing its workflow type.`),
  true,
  "a site may extend the sentence and the predicate still recognises the refusal",
);

// Every server surface that refuses on unowned state must hand the reader the
// ONE sentence, because two components choose their copy from its prefix: a
// site that kept its own words was invisible to this predicate and rendered the
// wrong advice next to the right chip. Counted by reading the sources, not by
// asserting the constant contains anything.
const refusalSources = [
  ["server/runtime/workflow-state.ts", "the requireOwnedState card-worker guard"],
  ["server/runtime/worker-respawn-preparation.ts", "the Restart-worker path"],
  ["server/runtime/cli/cli-gap-scopes.ts", "the gap-scopes worker CLI"],
  ["server/runtime/build-thread-sync.ts", "the card's own last_error"],
  ["server/runtime/cli-inspection.ts", "the playbook CLI"],
  ["server/runtime/cli/cli-done-build.ts", "the done-build CLI"],
  ["server/runtime/card-mutations.ts", "the workflow-type mutation"],
  ["server/runtime/card-audit-trail.ts", "the audit trail status"],
];
for (const [file, role] of refusalSources) {
  const source = readFileSync(join(root, file), "utf8");
  assert.match(
    source,
    /OWNERSHIP_UNVERIFIED/,
    `${file} (${role}) reads the shared sentence rather than holding its own copy of the words`,
  );
  // A re-spelled refusal is a string literal in the site that states the verdict
  // in its own words. Matched on the VERDICT rather than on the whole sentence,
  // so a site that trims the copy instead of pasting it verbatim is still caught:
  // the predicate recognises the prefix, not the prose after it. Comments are
  // stripped first because the reasoning ABOUT this refusal talks about the
  // verdict in the same words, and a docstring is not a string the reader sees.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(
    code,
    /"(?:[^"\\]|\\.)*(?:cannot be verified|owns this card)(?:[^"\\]|\\.)*"/i,
    `${file} (${role}) re-spells the refusal inline, which the predicate cannot recognise`,
  );
}

// The repair dialog advises retrying first for most failures, which is the
// right default and the wrong one here. Both arms are asserted because the
// inversion is silent in the other direction too: telling an ordinary broken
// worker that retry cannot help would send the reader to a reseed that throws
// away a run a retry would have fixed.
assert.match(
  ownershipRepairAdvice(OWNERSHIP_UNVERIFIED),
  /^Retry cannot help/,
  "an unowned card is told that the cheaper action cannot work",
);
assert.match(
  ownershipRepairAdvice("Provider error 400 from the model endpoint."),
  /^Try Retry first/,
  "an ordinary failure keeps the ordinary advice",
);
assert.match(
  ownershipRepairAdvice(null),
  /^Try Retry first/,
  "a card with no error keeps it too",
);
assert.notEqual(
  ownershipRepairAdvice(OWNERSHIP_UNVERIFIED),
  ownershipRepairAdvice("Provider error 400"),
  "the two cases must not read as one sentence with two titles",
);

console.log(
  "ownership refusal ok: one sentence, one predicate, one advice; the DOOR is proved in tests/reseed-unowned-door.test.mjs",
);