import assert from "node:assert/strict";
// The host runtime must exist before any component imports the plugin SDK.
import "./helpers/bb-runtime-stub.mjs";
import { createElement as h } from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import axe from "axe-core";

// P2 — the UI quality audit, finally rendered.
//
// The card reached `done` three runs in a row with this lens "Codebase mode
// only (~80%)": every component test read the .tsx as text, so the audit could
// describe the source but never a rendered tree, and nothing here claimed
// anyone looked at one. This runs the real component against a real DOM.
//
// A DOM library that cannot render is not evidence, so the last case proves the
// lens can FAIL: a knowingly broken tree must be flagged, by rule name.

import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/card.tsx";
import {
  ReviewQueue,
  REVIEW_QUEUE_RAIL_ID,
  REVIEW_QUEUE_TRIGGER_ID,
} from "../components/board/review-queue.tsx";
import { REVIEW_QUEUE_GATES } from "../lib/review-queue.mjs";

// --- a real component renders, and its text is reachable by query -----------

const card = render(
  h(Card, { "data-testid": "audit-card" },
    h(CardHeader, null, h(CardTitle, null, "Publication")),
    h(CardContent, null, h("p", null, "The panel writes a local commit and stops."))),
);
assert.ok(screen.getByText("Publication"), "a rendered title is queryable, not a string in a file");
assert.ok(
  screen.getByText(/writes a local commit/),
  "rendered prose is queryable — the thing a text pin cannot do",
);
assert.equal(card.container.querySelectorAll("[data-testid=audit-card]").length, 1);
assert.ok(card.container.textContent.length > 0, "the tree carries text, so it rendered");

// --- the accessibility lens runs on the real tree --------------------------

// WCAG only: the defensible bar for a component that renders inside the app's
// own layout. Best-practice rules (region, landmark-one-main) describe a whole
// page, not a fragment, so they are not a fair gate on one component.
const real = await axe.run(card.container, {
  resultTypes: ["violations"],
  runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
});
assert.equal(
  real.violations.length,
  0,
  `a plain card must stay clean; got ${real.violations.map((v) => v.id).join(", ")}`,
);
cleanup();

// --- the lens has teeth: a broken tree must be caught, by name --------------
//
// The shapes here are STRUCTURAL, and that is a measured limit of this lens,
// not a preference: axe detects interaction defects by listening for DOM
// handlers, and a React onClick is attached at the React root, not on the
// element — so `click-events-have-key-events` and its family do not fire on a
// React tree at all. A rendered audit therefore covers structure (names, alt,
// roles, labels) and not handler wiring; the P1 browser pass is what covers
// the latter, which is the honest reason P1 is worth its cost.

const broken = render(
  h("div", null,
    // An image with no alternative text — the canonical WCAG violation.
    h("img", { src: "/logo.png" }),
    // A control with no accessible name — also structural, also WCAG.
    h("button", { type: "button" }, h("span", { "aria-hidden": "true" }, "x"))));

const flagged = await axe.run(broken.container, {
  resultTypes: ["violations"],
  runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
});
const rules = flagged.violations.map((violation) => violation.id);
assert.ok(rules.includes("image-alt"), `the lens must catch image-alt; caught ${rules.join(", ") || "nothing"}`);
assert.ok(rules.includes("button-name"), `the lens must catch button-name; caught ${rules.join(", ") || "nothing"}`);
for (const violation of flagged.violations) {
  assert.ok(violation.nodes.length > 0, `${violation.id} must name the node it is about`);
}
cleanup();

// --- the review queue, which is new UI and therefore owes the same lens ------
//
// A rail that is opened by a count and closed by Escape is exactly the kind of
// surface that ships with an unnamed control: the row, the close and the retry
// are the only things a reader can touch, and none of them has a visible label
// that names it. So the audit renders it open, as a reader sees it.
{
  const cards = [
    { id: "a", displayName: "Card one", stage: REVIEW_QUEUE_GATES[0].id, activity: "idle", updatedAt: Date.now() },
    { id: "b", displayName: "Card two", stage: REVIEW_QUEUE_GATES[3].id, activity: "idle", updatedAt: Date.now() },
  ];
  const rpc = {
    call: async () => ({
      notifications: cards.map((card) => ({
        cardId: card.id,
        kind: "completed",
        occurredAt: Date.now() - 86_400_000,
        readAt: null,
        resolvedAt: null,
        archivedAt: null,
      })),
    }),
  };
  const queue = render(h(ReviewQueue, { rpc, cards, onOpenCard: () => {} }));
  const trigger = () => document.getElementById(REVIEW_QUEUE_TRIGGER_ID);
  await waitFor(() => assert.equal(trigger().getAttribute("aria-expanded"), "false"));
  fireEvent.click(trigger());
  assert.ok(document.getElementById(REVIEW_QUEUE_RAIL_ID), "the audit renders the rail open, not just its trigger");
  const audit = await axe.run(queue.container, {
    resultTypes: ["violations"],
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
  });
  assert.deepEqual(
    audit.violations.map((violation) => violation.id),
    [],
    "the review queue is clean under the same lens the rest of the UI is held to",
  );
  window.localStorage.clear();
  cleanup();
}

// --- the two cells the queue grew, rendered and audited --------------------
//
// `no owner named` and `in gate` are prose standing where a number usually is.
// Prose in a numeric column is exactly where a reader loses the plot, so the
// audit renders them and puts the same lens on the rail: if the marker is
// unreadable or unnamed, this fails here rather than in someone's morning.
{
  const HOUR = 3_600_000;
  const cards = [
    {
      id: "mine",
      displayName: "Mine",
      stage: REVIEW_QUEUE_GATES[1].id,
      activity: "idle",
      updatedAt: Date.now(),
      stageEnteredAt: Date.now() - 5 * HOUR,
    },
    {
      id: "orphan",
      displayName: "Orphan",
      stage: REVIEW_QUEUE_GATES[2].id,
      activity: "idle",
      updatedAt: Date.now(),
      stageEnteredAt: Date.now() - 26 * HOUR,
    },
    {
      id: "no-entry",
      displayName: "No entry",
      stage: REVIEW_QUEUE_GATES[0].id,
      activity: "idle",
      updatedAt: Date.now(),
      createdAt: Date.now() - 72 * HOUR,
    },
  ];
  const rpc = {
    call: async () => ({
      notifications: [
        { cardId: "mine", kind: "completed", occurredAt: Date.now() - HOUR, readAt: null, resolvedAt: null, archivedAt: null },
        { cardId: "no-entry", kind: "completed", occurredAt: Date.now() - HOUR, readAt: null, resolvedAt: null, archivedAt: null },
      ],
    }),
  };
  const queue = render(h(ReviewQueue, { rpc, cards, onOpenCard: () => {} }));
  const trigger = () => document.getElementById(REVIEW_QUEUE_TRIGGER_ID);
  await waitFor(() => assert.equal(trigger().getAttribute("aria-expanded"), "false"));
  fireEvent.click(trigger());
  assert.ok(screen.getAllByText(/no owner named/).length > 0, "the unowned marker renders as text a reader can hear");
  assert.ok(screen.getAllByText(/in gate/).length > 0, "the fallback clock says what it is instead of printing a wait");
  assert.ok(screen.getByText(/\+1 without an owner/), "and the count line names the card it excludes");
  const audit = await axe.run(queue.container, {
    resultTypes: ["violations"],
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
  });
  assert.deepEqual(
    audit.violations.map((violation) => violation.id),
    [],
    "the rail stays clean under the same lens with prose in the age column",
  );
  window.localStorage.clear();
  cleanup();
}

console.log(
  "rendered-ui audit ok: a real component renders and queries, the axe lens is clean on it,"
  + " and a broken tree is flagged by rule — so a green run here means someone looked",
);
