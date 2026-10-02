import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, screen, cleanup } from "@testing-library/react";
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

console.log(
  "rendered-ui audit ok: a real component renders and queries, the axe lens is clean on it,"
  + " and a broken tree is flagged by rule — so a green run here means someone looked",
);
