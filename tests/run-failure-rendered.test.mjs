import assert from "node:assert/strict";
import test from "node:test";
import { createElement as h } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import axe from "axe-core";
import { CardMetaRows } from "../components/board/board-cards.tsx";
import { ReasonPopover, shouldOpenReasonPanel, clampReasonPanel } from "../components/ui/reason-popover.tsx";

/**
 * The run-failure chip, rendered — at the CardMetaRows boundary.
 *
 * CardMetaRows is the largest subtree that renders without a host stub: it
 * calls no useRpc/useBbNavigate path. BoardCard itself is NOT renderable here
 * (useBbNavigate is undefined outside the host bundle), so the two BoardCard
 * interactions — the chip not opening the card, AC-12's "the card does not
 * open" — are a RECORDED LOSS, not a skipped assertion. What backs them
 * instead is the stopPropagation boundary case below plus the BoardCardSelect
 * precedent the trigger follows.
 *
 * Outside-press dismissal DOES restore focus (human planning decision,
 * implemented in components/ui/use-dismiss-menu.ts), so focus return is
 * asserted on BOTH the Escape and the outside-press paths.
 */

const RUN_DETAIL = "The host could not start the run.";
const WORKER_DETAIL = "Workflow state ownership cannot be verified.";

function baseCard(overrides = {}) {
  return {
    activity: "idle",
    lastError: null,
    needsAttention: false,
    runFailure: { label: "Run failed", detail: RUN_DETAIL },
    integrationPending: null,
    executingScope: null,
    doingNow: [],
    projectName: "P",
    updatedAt: 1_000,
    status: "in-progress",
    hasPendingReview: false,
    ...overrides,
  };
}

function trigger(container) {
  const button = container.querySelector("button[aria-expanded]");
  assert.ok(button, "the failure chip renders a real button trigger");
  return button;
}

function touchOpen(container) {
  const button = trigger(container);
  fireEvent.pointerDown(button, { pointerType: "touch" });
  fireEvent.click(button, { detail: 1 });
  return button;
}

test("a card whose only alert is the failed run renders the row and one chip", () => {
  // The v1/v2 critical, asserted over rendered output: idle, no worker stop,
  // no attention, no integration-pending, no pending review — the row must
  // still appear, carrying exactly one red chip labelled Run failed.
  const { container } = render(h(CardMetaRows, { card: baseCard() }));
  try {
    assert.equal(screen.getByText("Run failed").textContent, "Run failed");
    assert.equal(screen.queryByText("Stopped with an error"), null, "no worker chip without a worker failure");
    assert.equal(screen.queryByText("Paused"), null);
    const row = container.firstChild;
    assert.ok(row && row.textContent.includes("Run failed"), "the alert row renders with the chip inside it");
    const chip = screen.getByText("Run failed").closest("span[title]");
    assert.equal(chip?.getAttribute("title"), RUN_DETAIL, "hover stays the native title channel with the reason");
  } finally {
    cleanup();
  }
});

test("a stopped worker plus a failed run renders one chip with the worker reason", () => {
  // The stated loss: two broken subsystems with different remedies read as
  // one red here, and the worker wins — it is the state the reader can act on.
  const { container } = render(h(CardMetaRows, {
    card: baseCard({ activity: "error", lastError: WORKER_DETAIL }),
  }));
  try {
    assert.equal(screen.getByText("Stopped with an error").textContent, "Stopped with an error");
    assert.equal(screen.queryByText("Run failed"), null, "no second chip, count or marker for the run failure");
    const chip = screen.getByText("Stopped with an error").closest("span[title]");
    assert.equal(chip?.getAttribute("title"), WORKER_DETAIL, "the chip carries the worker reason on the hover channel");
    assert.ok(!container.innerHTML.includes(RUN_DETAIL), "the run reason is reachable only in Execution runs");
  } finally {
    cleanup();
  }
});

test("tapping the chip opens the portaled panel with the reason", () => {
  const { container } = render(h(CardMetaRows, { card: baseCard() }));
  try {
    const button = touchOpen(container);
    assert.equal(button.getAttribute("aria-expanded"), "true", "the trigger announces the open panel");
    const controls = button.getAttribute("aria-controls");
    assert.ok(controls, "the trigger names the panel it controls");
    const panel = document.getElementById(controls);
    assert.ok(panel, "the panel exists in the document, outside the clipping tile");
    assert.equal(panel.textContent, RUN_DETAIL, "the panel carries the reason and nothing else");
    assert.ok(!container.contains(panel), "the panel is portaled, not in-place — the tile clips its own overlay");
  } finally {
    cleanup();
  }
});

test("Escape closes the panel and returns focus to the trigger", () => {
  const { container } = render(h(CardMetaRows, { card: baseCard() }));
  try {
    const button = touchOpen(container);
    assert.ok(document.getElementById(button.getAttribute("aria-controls")), "the panel is open");
    fireEvent.keyDown(window, { key: "Escape" });
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.equal(screen.queryByText(RUN_DETAIL) === null || !document.body.textContent.includes(RUN_DETAIL), true);
    assert.equal(document.activeElement, button, "focus returns to the trigger");
  } finally {
    cleanup();
  }
});

test("an outside press closes the panel and returns focus to the trigger", () => {
  const { container } = render(h(CardMetaRows, { card: baseCard() }));
  try {
    const button = touchOpen(container);
    assert.ok(document.getElementById(button.getAttribute("aria-controls")), "the panel is open");
    fireEvent.mouseDown(document.body);
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, button, "focus returns to the trigger on the outside-press path too");
  } finally {
    cleanup();
  }
});

test("a mouse click does not open the panel", () => {
  // Hover already serves the mouse channel through the chip's native title;
  // a panel on top of the tooltip would double-display.
  const { container } = render(h(CardMetaRows, { card: baseCard() }));
  try {
    const button = trigger(container);
    fireEvent.pointerDown(button, { pointerType: "mouse" });
    fireEvent.click(button, { detail: 1 });
    assert.equal(button.getAttribute("aria-expanded"), "false", "a real-pointer click is rejected by the predicate");
    assert.equal(document.body.querySelectorAll("div[id]").length, 0, "no panel is portaled");
  } finally {
    cleanup();
  }
});

test("keyboard activation opens the panel", () => {
  // A keyboard-activated click fires no pointer, so detail is 0 — the same
  // signal the predicate accepts. Focus the trigger, Enter opens.
  const { container } = render(h(CardMetaRows, { card: baseCard() }));
  try {
    const button = trigger(container);
    button.focus();
    fireEvent.click(button);
    assert.equal(button.getAttribute("aria-expanded"), "true", "detail 0 opens without any pointer");
  } finally {
    cleanup();
  }
});

test("opening the reason does not bubble a click to the card", () => {
  // The CardMetaRows boundary for the recorded BoardCard loss: a test-owned
  // div[role=button] stands in for the card root with a click spy. With
  // stopPropagation the parent sees zero clicks; without it, one.
  let parentClicks = 0;
  const { container } = render(h("div", { role: "button", onClick: () => { parentClicks += 1; } },
    h(CardMetaRows, { card: baseCard() })));
  try {
    touchOpen(container);
    assert.ok(screen.getByText(RUN_DETAIL), "the panel opened, so the click reached the trigger");
    assert.equal(parentClicks, 0, "the trigger stopped the click — the card must not open beneath the reason");
  } finally {
    cleanup();
  }
});

test("a chip-heavy card renders every chip in one row", () => {
  // Wrap is today's measured behaviour and happy-dom lays out nothing, so the
  // honest assertion is presence: nothing clips a chip away when the row is
  // full. The fullest real row with a run chip is idle + needsAttention +
  // integration-pending: run failure, pause, amber attention, integration.
  // (A doing-now pill needs running/awaiting-answer, which excludes the idle
  // attention chip — the two never share a row, so heaviness is asserted with
  // the four that can co-occur.)
  const { container } = render(h(CardMetaRows, {
    card: baseCard({
      needsAttention: true,
      integrationPending: { state: "local", label: "Not integrated", detail: "Unpublished work." },
    }),
  }));
  try {
    for (const label of ["Run failed", "Paused", "Paused. Resume it.", "Not integrated"]) {
      assert.ok(screen.queryByText(label) !== null, `the full row still carries "${label}"`);
    }
    const rows = container.querySelectorAll("div.mt-2.flex.min-w-0.flex-wrap");
    assert.equal(rows.length, 1, "one alert row holds them all");
    assert.ok(rows[0].textContent.includes("Run failed"), "the failure chip is in that row");
  } finally {
    cleanup();
  }
});

test("the reveal predicate opens on tap and keyboard, never on a mouse click", () => {
  // Pure over { pointerType, detail }, so the modality rule is testable with
  // no DOM: a tap or pen opens, a keyboard-activated click (no pointer fired
  // one) opens, a mouse click does not.
  assert.equal(shouldOpenReasonPanel({ pointerType: "touch", detail: 1 }), true, "a tap opens");
  assert.equal(shouldOpenReasonPanel({ pointerType: "pen", detail: 1 }), true, "a pen opens");
  assert.equal(shouldOpenReasonPanel({ pointerType: undefined, detail: 0 }), true, "a keyboard-activated click opens");
  assert.equal(shouldOpenReasonPanel({ pointerType: "mouse", detail: 1 }), false, "a mouse click stays on hover");
});

test("the panel lands below the trigger when it fits, above it otherwise", () => {
  const roomy = { width: 1280, height: 800 };
  assert.deepEqual(
    clampReasonPanel({ top: 100, bottom: 140, left: 200 }, roomy),
    { top: 146, left: 200 },
    "below the trigger with a 6px gap when the 160px budget fits",
  );
  assert.deepEqual(
    clampReasonPanel({ top: 700, bottom: 740, left: 200 }, roomy).top,
    534,
    "above the trigger when below would leave the viewport",
  );
  assert.deepEqual(
    clampReasonPanel({ top: 100, bottom: 140, left: 2 }, roomy).left,
    8,
    "pinned 8px inside the viewport on the left",
  );
  assert.deepEqual(
    clampReasonPanel({ top: 100, bottom: 140, left: 1200 }, roomy).left,
    952,
    "pinned 8px inside the viewport on the right",
  );
});

test("the rendered failure row is clean under the accessibility lens", async () => {
  // Structural only, like the existing audit: axe on a React tree covers
  // names and roles, never handler wiring — which is why the interaction
  // cases above exist beside it.
  const { container } = render(h(CardMetaRows, { card: baseCard() }));
  try {
    const results = await axe.run(container, {
      resultTypes: ["violations"],
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
    });
    assert.equal(
      results.violations.length,
      0,
      `the failure row must stay clean; got ${results.violations.map((v) => v.id).join(", ")}`,
    );
  } finally {
    cleanup();
  }
});

test("ReasonPopover renders the chip with its reason on the title", () => {
  const { container } = render(h(ReasonPopover, { label: "Run failed", detail: RUN_DETAIL }));
  try {
    assert.equal(screen.getByText("Run failed").textContent, "Run failed");
    assert.equal(trigger(container).getAttribute("aria-expanded"), "false", "closed until tapped or keyboard-opened");
  } finally {
    cleanup();
  }
});
