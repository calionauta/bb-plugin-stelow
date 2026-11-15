import assert from "node:assert/strict";
// The host runtime must exist before any component imports the plugin SDK.
import "./helpers/bb-runtime-stub.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement as h } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ReviewQueue, REVIEW_QUEUE_TRIGGER_ID } from "../components/board/review-queue.tsx";
import { REVIEW_QUEUE_GATES } from "../lib/review-queue.mjs";

/**
 * The queue is a read-only surface, and it reads one thing.
 *
 * It sits on the board's chrome, one click from every card, so the cheapest way
 * for it to become a problem is to grow a write: marking a notification read
 * while drawing the rail ("opening the queue is reading the card"), archiving a
 * row from a list item, or answering a question from a rail that has no room to
 * show the question. Every one of those would turn a glance at the board into
 * state nobody asked for, and the downloaded inbox payload into a surface that
 * can mutate it.
 *
 * So this file pins three things: the only RPC it calls, that a card name is
 * rendered as text and never as markup, and that the rail shows the row's
 * identifying facts rather than the card's contents.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DAY = 86_400_000;
const T = Date.now();
const PRODUCT_GATE = REVIEW_QUEUE_GATES[0].id;
const CODE_GATE = REVIEW_QUEUE_GATES[3].id;

function stubRpc() {
  const calls = [];
  return {
    calls,
    call: async (name, input) => {
      calls.push({ name, input });
      return {
        notifications: [
          { cardId: "a", kind: "completed", occurredAt: T - 2 * DAY, readAt: null, resolvedAt: null, archivedAt: null },
          { cardId: "b", kind: "question", occurredAt: T - DAY, readAt: null, resolvedAt: null, archivedAt: null },
        ],
      };
    },
  };
}

const assertReadOnly = (rpc, when) =>
  assert.deepEqual(
    [...new Set(rpc.calls.map((call) => call.name))],
    ["listNotifications"],
    `${when}: the queue's only rpc is the ledger read — no write, no archive, no mark-read, no per-card detail`,
  );

// --- 1. One read, and it is a read ---------------------------------------
const rpc = stubRpc();
const cards = [
  { id: "a", displayName: "Alpha", stage: PRODUCT_GATE, activity: "idle", updatedAt: T, stageEnteredAt: T - 2 * DAY },
  { id: "b", displayName: "Beta", stage: CODE_GATE, activity: "idle", updatedAt: T, stageEnteredAt: T - DAY },
];
render(h(ReviewQueue, { rpc, cards, onOpenCard: () => {} }));
await waitFor(() => assert.match(document.getElementById(REVIEW_QUEUE_TRIGGER_ID).textContent, /2 · 2d/));
assertReadOnly(rpc, "on mount");
for (const call of rpc.calls) {
  assert.deepEqual(
    call.input,
    { includeArchived: false },
    "archived history is not pulled: the queue is about what is waiting now, not what was",
  );
}
fireEvent.click(document.getElementById(REVIEW_QUEUE_TRIGGER_ID));
assertReadOnly(rpc, "opening the rail");
const rows = Array.from(document.querySelectorAll("[data-review-queue-row]"));
assert.equal(rows.length, 2);
fireEvent.click(rows[0]);
assertReadOnly(rpc, "opening a card from a row: the rail asks for nothing on the way out");
cleanup();
window.localStorage.clear();

// --- 2. A card name is text, not markup ----------------------------------
//
// Card names are written by whoever created the card (or by a model), so the
// rail treats them the way the board does: as a string. This is the assertion
// that would fail if the row ever grew `dangerouslySetInnerHTML`.
{
  const hostile = '<img src=x onerror="alert(1)">Delta';
  const hostileRpc = stubRpc();
  render(h(ReviewQueue, {
    rpc: hostileRpc,
    cards: [{ id: "a", displayName: hostile, stage: PRODUCT_GATE, activity: "idle", updatedAt: T, stageEnteredAt: T - 2 * DAY }],
    onOpenCard: () => {},
  }));
  await waitFor(() => assert.match(document.getElementById(REVIEW_QUEUE_TRIGGER_ID).textContent, /1 · 2d/));
  fireEvent.click(document.getElementById(REVIEW_QUEUE_TRIGGER_ID));
  assert.equal(document.querySelector("img"), null, "no element is created out of a card name");
  assert.ok(
    document.querySelector("[data-review-queue-rail]").textContent.includes(hostile),
    "the name reaches the reader as the literal text it is",
  );
  cleanup();
  window.localStorage.clear();
}

// --- 3. The rail shows the row, not the card ------------------------------
//
// A queue row is name, gate and age. The card's prompt, its scope list and its
// last error are the detail's business; a rail 280px wide has no room to show
// them and every one of them is something a reader glancing at the board did not
// ask to have rendered.
{
  const cardRpc = stubRpc();
  render(h(ReviewQueue, {
    rpc: cardRpc,
    cards: [{
      id: "a",
      displayName: "Alpha",
      name: "alpha-internal",
      stage: PRODUCT_GATE,
      activity: "idle",
      updatedAt: T,
      stageEnteredAt: T - 2 * DAY,
      prompt: "SECRET-PROMPT-TEXT",
      lastError: "SECRET-ERROR-TEXT",
      projectName: "SECRET-PROJECT",
    }],
    onOpenCard: () => {},
  }));
  await waitFor(() => assert.match(document.getElementById(REVIEW_QUEUE_TRIGGER_ID).textContent, /1 · 2d/));
  fireEvent.click(document.getElementById(REVIEW_QUEUE_TRIGGER_ID));
  const text = document.querySelector("[data-review-queue-rail]").textContent;
  for (const forbidden of ["SECRET-PROMPT-TEXT", "SECRET-ERROR-TEXT", "SECRET-PROJECT"]) {
    assert.equal(text.includes(forbidden), false, `the rail does not render ${forbidden}`);
  }
  cleanup();
  window.localStorage.clear();
}

// --- 4. Nothing in the surface can inject markup --------------------------
for (const file of [
  "components/board/review-queue.tsx",
  "components/board/review-queue-rail.tsx",
  "components/board/use-review-queue.ts",
  "lib/review-queue.mjs",
]) {
  const source = readFileSync(join(root, file), "utf8");
  for (const banned of ["dangerouslySetInnerHTML", "innerHTML", "eval(", "new Function("]) {
    assert.equal(source.includes(banned), false, `${file} never uses ${banned}`);
  }
}

console.log("review queue security test ok");
