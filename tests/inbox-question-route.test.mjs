/**
 * Which door an Inbox row's question opens.
 *
 * A row about a question can offer a narrow second door — the ask and its
 * evidence, without the card's other eight sections — and this gate decides
 * whether that door is safe. Three refusals, and the point of the file is that
 * each one NAMES WHERE THE READER GOES INSTEAD: a refusal without an exit is a
 * deadlock with a good error message, and a row that silently did nothing is
 * worse than a row with one door.
 *
 * MUTATIONS RUN (broken, seen red, restored):
 *  drop the kind check                     -> "only a question row gets the door"
 *  drop the split refusal                  -> "a split answer is card-scoped"
 *  invert the document-viewer check        -> "the door needs a viewer"
 *  return route "card" without an exit     -> "every refusal names an exit"
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  QUESTION_ROUTE_REFUSALS,
  inboxQuestionRoute,
  isQuestionRouteCandidate,
} from "../lib/inbox-question-route.mjs";

const question = { kind: "question", cardId: "card_a", id: "evt_1" };
const open = { hasDocumentViewer: true, hasSplitQuestion: false };

test("a question row on a host that can open its evidence gets the narrow door", () => {
  assert.deepEqual(
    inboxQuestionRoute(question, open),
    { route: "direct", reason: "question-with-evidence" },
    "the narrow door is the default when nothing disqualifies it",
  );
  assert.equal(isQuestionRouteCandidate(question), true, "and the row is a candidate for it");
});

test("the door is opened for questions and nothing else", () => {
  // An error row has no decision to make; a completion is review work. Sending
  // either to a question-shaped view would render an empty door.
  for (const kind of ["error", "paused", "completed"]) {
    const verdict = inboxQuestionRoute({ ...question, kind }, open);
    assert.equal(verdict.route, "card", `a ${kind} row keeps the one door it had`);
    assert.equal(verdict.reason, "not-a-question", `and the refusal says why: ${kind} is not a question`);
    assert.ok(verdict.exit.length > 0, `the refusal names where the reader goes instead (${kind})`);
  }
  assert.equal(inboxQuestionRoute(null, open).route, "card", "no event at all is not a question");
  assert.equal(inboxQuestionRoute(undefined, open).route, "card", "an absent event is not a question either");
  assert.equal(isQuestionRouteCandidate({ kind: "error" }), false, "and the candidate check agrees");
});

test("a batch containing a split question refuses the narrow door", () => {
  // Answering a split CREATES CHILD CARDS and archives the parent. That is a
  // consequence of the card, not of the question, and its keep-versus-deliver
  // exclusivity notice only makes sense where the card is — so the row sends
  // the reader there rather than offering a door onto a card-wide decision.
  const verdict = inboxQuestionRoute(question, { hasDocumentViewer: true, hasSplitQuestion: true });
  assert.equal(verdict.route, "card", "a split batch is answered on the card");
  assert.equal(verdict.reason, "split-creates-cards", "and the refusal names that reason, not a generic one");
  assert.match(verdict.exit, /card/i, "the exit names the card as the destination");
});

test("without a document viewer the narrow door is refused", () => {
  // An option's attached document is part of the decision. On a host where it
  // cannot open, the narrow view would ask the reader to decide while hiding
  // the evidence — so it refuses and the reader gets the full card, where the
  // other affordances exist.
  const verdict = inboxQuestionRoute(question, { hasDocumentViewer: false, hasSplitQuestion: false });
  assert.equal(verdict.route, "card", "no viewer means no narrow door, even for a plain question");
  assert.equal(verdict.reason, "no-document-viewer", "the refusal names the missing capability");
  assert.equal(inboxQuestionRoute(question, {}).route, "card", "an empty options object is not an assumption in the door's favour");
  assert.equal(inboxQuestionRoute(question).route, "card", "and neither is no options at all — the gate fails closed");
});

test("the split refusal outranks the viewer question", () => {
  // Order matters for the MESSAGE a reader gets: "this creates cards" is the
  // real reason to go to the card, and reporting a missing viewer instead would
  // send them looking for a capability they do not need here.
  const verdict = inboxQuestionRoute(question, { hasDocumentViewer: true, hasSplitQuestion: true });
  assert.equal(verdict.reason, "split-creates-cards", "the consequence outranks the capability");
});

test("every refusal names an exit, and every reason is declared", () => {
  // The invariant that makes a refusal usable, asserted over every path rather
  // than spot-checked: a new refusal added without an exit fails here.
  const cases = [
    inboxQuestionRoute(null, open),
    inboxQuestionRoute({ kind: "error" }, open),
    inboxQuestionRoute(question, {}),
    inboxQuestionRoute(question, { hasDocumentViewer: true, hasSplitQuestion: true }),
  ];
  for (const verdict of cases) {
    assert.equal(verdict.route, "card", "a refusal routes to the card");
    assert.ok(
      typeof verdict.exit === "string" && verdict.exit.trim().length > 0,
      `every refusal must tell the reader where to go: ${verdict.reason}`,
    );
    assert.equal(
      QUESTION_ROUTE_REFUSALS[verdict.reason],
      verdict.exit,
      `the exit is the declared copy for ${verdict.reason}, not an ad-hoc string`,
    );
  }
  assert.ok(Object.keys(QUESTION_ROUTE_REFUSALS).length >= 3, "all three refusals are declared in one place");
});

console.log("inbox question route test ok: one door, one refusal, and an exit for each");
