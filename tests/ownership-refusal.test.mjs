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

assert.equal(
  isOwnershipRefusal(OWNERSHIP_UNVERIFIED),
  true,
  "the sentence recognises itself",
);
assert.equal(
  isOwnershipRefusal(`${OWNERSHIP_UNVERIFIED} Reseed this card before changing its workflow type.`),
  true,
  "a site may append its own tail and still be the refusal",
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

// The sentence has to name a door that exists, or naming it is worse than the
// silence it replaced. Both halves are literal UI copy, so they are pinned
// against the components rather than against prose in this file.
const menu = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../components/manage/card-actions-menu.tsx"), "utf8");
assert.match(OWNERSHIP_UNVERIFIED, /Restart fresh…/, "the refusal names the action, not just the intent");
assert.match(OWNERSHIP_UNVERIFIED, /card actions menu/, "and says where the action lives");
assert.match(OWNERSHIP_UNVERIFIED, /Retry cannot help/, "and rules out the button a reader reaches for first");
assert.match(
  menu,
  /Restart fresh…/,
  "the action the refusal names is a label the menu really renders",
);

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

// The component reads the advice rather than choosing it inline: a ternary in
// JSX can only be tested by matching source, and this decision is the one that
// has to survive being re-spelled.
const dialogs = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../components/detail/build-lifecycle-dialogs.tsx"),
  "utf8",
);
assert.match(dialogs, /ownershipRepairAdvice\(cardLastError\)/, "the dialog reads the shared advice");
assert.doesNotMatch(
  dialogs,
  /Try Retry first/,
  "the advice is not re-spelled in the component, so it cannot drift from the predicate",
);

console.log("ownership refusal ok: one sentence, one predicate, one advice, the door it names exists");