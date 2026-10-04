import assert from "node:assert/strict";
import test from "node:test";
import {
  SCOPE_ADJUST_TAG,
  SCOPE_ASK_MAX_OPTIONS,
  scopeAskRefusal,
} from "../lib/scope-ask-gate.mjs";

/**
 * Scope confirms are marked, not guessed.
 *
 * On card_a9q5zhzd a scope confirm arrived untagged, unchecked, unchunked
 * (7 options), and half single-select — four deviations no gate could name,
 * because nothing marked a question AS a scope confirm while the mode rule
 * (Auto decides itself, never parks) lived only in skill prose the worker
 * skipped. The tag carries the shape; the gate reads the tag plus the
 * workflow's own mode label, never the question text.
 */

const keep = (labels, selected = true) => ({
  question: "Keep IN?",
  multiple: true,
  options: labels.map((label) => ({ label, ...(selected ? { selected: true } : {}) })),
});

test("untagged asks pass through untouched", () => {
  assert.equal(scopeAskRefusal({ tag: null, reviewMode: "Auto", groups: [keep(["A"])] }), null);
  assert.equal(scopeAskRefusal({ tag: "split", reviewMode: "Auto", groups: [keep(["A"])] }), null);
});

test("Auto refuses a scope confirm with the way out", () => {
  const reason = scopeAskRefusal({ tag: SCOPE_ADJUST_TAG, reviewMode: "Auto", groups: [keep(["A"])] });
  assert.match(reason, /review mode is Auto/, "names the mode that decides, not just the word");
  assert.match(reason, /decide|adjust/i, "and tells the worker to decide instead of parking");
});

test("a well-formed confirm passes in a gated mode", () => {
  assert.equal(
    scopeAskRefusal({ tag: SCOPE_ADJUST_TAG, reviewMode: "Product Spec Gate", groups: [keep(["A", "B"])] }),
    null,
  );
});

test("unknown modes fail open", () => {
  for (const reviewMode of [null, undefined, "", "BOGUS"]) {
    assert.equal(
      scopeAskRefusal({ tag: SCOPE_ADJUST_TAG, reviewMode, groups: [keep(["A"])] }),
      null,
      "an unreadable or unrecognized mode must never silence a real ask",
    );
  }
});

test("the Auto match ignores case and padding", () => {
  for (const reviewMode of ["auto", "AUTO", " Auto "]) {
    assert.match(
      scopeAskRefusal({ tag: SCOPE_ADJUST_TAG, reviewMode, groups: [keep(["A"])] }) ?? "",
      /review mode is Auto/,
      `${JSON.stringify(reviewMode)} evidently means Auto`,
    );
  }
});

test("a single-select scope group is refused", () => {
  const reason = scopeAskRefusal({
    tag: SCOPE_ADJUST_TAG,
    reviewMode: "Product Spec Gate",
    groups: [{ question: "Add?", multiple: false, options: [{ label: "A" }, { label: "B" }] }],
  });
  assert.match(reason, /--multiple/, "and names the flag that fixes the widget");
});

test(`more than ${SCOPE_ASK_MAX_OPTIONS} options are refused`, () => {
  const labels = Array.from({ length: SCOPE_ASK_MAX_OPTIONS + 1 }, (_, i) => `Scope ${i}`);
  const reason = scopeAskRefusal({
    tag: SCOPE_ADJUST_TAG,
    reviewMode: "Product Spec Gate",
    groups: [keep(labels)],
  });
  assert.match(reason, new RegExp(String(SCOPE_ASK_MAX_OPTIONS)), "and names the ceiling");
  assert.match(reason, /split|chunk|batch/i, "and the way to fit");
});

test("exactly six options pass", () => {
  const labels = Array.from({ length: SCOPE_ASK_MAX_OPTIONS }, (_, i) => `Scope ${i}`);
  assert.equal(
    scopeAskRefusal({ tag: SCOPE_ADJUST_TAG, reviewMode: "Product Spec Gate", groups: [keep(labels)] }),
    null,
  );
});

test("an all-unchecked confirm is refused", () => {
  const reason = scopeAskRefusal({
    tag: SCOPE_ADJUST_TAG,
    reviewMode: "Product Spec Gate",
    groups: [keep(["A", "B"], false)],
  });
  assert.match(reason, /--selected/, "opt-out with nothing checked is the exact failure to name");
  assert.match(reason, /opt-out/i);
});

test("one checked option anywhere satisfies the batch", () => {
  assert.equal(
    scopeAskRefusal({
      tag: SCOPE_ADJUST_TAG,
      reviewMode: "Product Spec Gate",
      groups: [keep(["A"]), keep(["B"], false)],
    }),
    null,
    "add-groups legitimately start unchecked; one checked keep is enough",
  );
});

test("degenerate groups refuse as shape violations, never crash", () => {
  const mode = { tag: SCOPE_ADJUST_TAG, reviewMode: "Product Spec Gate" };
  assert.match(scopeAskRefusal({ ...mode, groups: [null] }) ?? "", /single-select/, "a null group cannot be multiple");
  assert.match(
    scopeAskRefusal({ ...mode, groups: [{ question: "Keep?", multiple: true }] }) ?? "",
    /--selected/,
    "options missing entirely still ends at the opt-out refusal",
  );
});

test("only an explicit true preselects", () => {
  const reason = scopeAskRefusal({
    tag: SCOPE_ADJUST_TAG,
    reviewMode: "Product Spec Gate",
    groups: [{ question: "Keep?", multiple: true, options: [{ label: "Something real", selected: 1 }] }],
  });
  assert.match(reason ?? "", /--selected/, "truthy is not checked — the CLI only ever emits true or absent");
});

console.log("scope ask gate test ok: tagged shape enforced, Auto refused, unknown modes fail open");
