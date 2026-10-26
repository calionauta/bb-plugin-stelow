import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createElement as h } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// The artifact review controls, rendered — not grepped.
//
// Requirement: a row in `review.marks` gets a review control keyed by its path;
// a row the server did not mark gets none. That negative is the point of the
// test: a control on an unmarked row can only end in a server refusal, so the UI
// must not offer it.
//
// Harness note (same as question-needs-note-ui): artifact-inventory.tsx imports
// useRpc from the plugin SDK at module load, and the SDK snapshots
// globalThis.__bbPluginRuntime then — so the stub is installed BEFORE the
// dynamic import below.

globalThis.__bbPluginRuntime = {
  pluginSdkApp: {
    useRpc: () => ({ call: async () => ({ ok: true }) }),
  },
};

const { ArtifactInventory } = await import("../components/artifacts/artifact-inventory.tsx");

const ALPHA_PATH = "deliverables/spec.md";
const BETA_PATH = "deliverables/audit-notes.md";

function artifact(path, display) {
  return {
    kind: "doc",
    path,
    display,
    generatedAt: "",
    absolutePath: `/work/${path}`,
    hostId: "host_1",
  };
}

const ALPHA = artifact(ALPHA_PATH, "Build spec");
const BETA = artifact(BETA_PATH, "Audit notes");

// Every accessible name a review control may carry. Anchored so a view-row
// button whose name merely contains the display cannot satisfy a positive
// lookup, and so the negative lookups cannot miss a control.
function reviewControls(display) {
  const prefix = "^(Mark reviewed|Reviewed|Review again|Clear the stale reviewed mark|Saving…): ";
  return screen.queryAllByRole("button", { name: new RegExp(`${prefix}${display}$`) });
}

function rowButton(display) {
  // The row's own button opens the file; its name starts with the display and
  // continues with the generated-at/file metadata.
  return screen.getByRole("button", { name: new RegExp(`^${display} File: `) });
}

function showRows({ marks, pendingPath = null, withReview = true } = {}) {
  const toggles = [];
  const review = withReview
    ? { marks, pendingPath, onToggle: (path, reviewed) => toggles.push([path, reviewed]) }
    : null;
  render(h(ArtifactInventory, {
    groups: [{ id: "deliverables", title: "Deliverables", items: [ALPHA, BETA] }],
    workspaceKind: "build",
    fileEnvironmentId: null,
    onView: () => {},
    review,
  }));
  return toggles;
}

afterEach(cleanup);

test("an unmarked row offers Mark reviewed and reports the path as not reviewed", () => {
  const toggles = showRows({ marks: new Map([[ALPHA_PATH, { reviewed: false, stale: false }]]) });
  const control = screen.getByRole("button", { name: "Mark reviewed: Build spec" });
  fireEvent.click(control);
  assert.deepEqual(toggles, [[ALPHA_PATH, false]], "the row's own path and mark state reach onToggle");
  assert.equal(
    screen.queryByRole("button", { name: "Clear the stale reviewed mark: Build spec" }),
    null,
    "only a stale mark offers the second Clear control",
  );
});

test("a reviewed row offers Reviewed and clicking clears the mark", () => {
  const toggles = showRows({ marks: new Map([[ALPHA_PATH, { reviewed: true, stale: false }]]) });
  const control = screen.getByRole("button", { name: "Reviewed: Build spec" });
  fireEvent.click(control);
  assert.deepEqual(toggles, [[ALPHA_PATH, true]], "clearing reports the row as reviewed");
});

test("a stale row offers Review again plus Clear, and says why it is stale", () => {
  const toggles = showRows({
    marks: new Map([
      [ALPHA_PATH, { reviewed: false, stale: true }],
      [BETA_PATH, { reviewed: false, stale: false }],
    ]),
  });
  fireEvent.click(screen.getByRole("button", { name: "Review again: Build spec" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear the stale reviewed mark: Build spec" }));
  assert.deepEqual(
    toggles,
    [[ALPHA_PATH, false], [ALPHA_PATH, true]],
    "Review again marks, Clear unmarks, both for the stale row's path",
  );
  const staleNotes = screen.getAllByText("Reviewed before the file changed");
  assert.equal(staleNotes.length, 1, "only the stale row explains that the file changed after review");
});

test("a row absent from marks gets no review control while its marked sibling does", () => {
  const toggles = showRows({ marks: new Map([[ALPHA_PATH, { reviewed: false, stale: false }]]) });
  rowButton("Build spec");
  rowButton("Audit notes");
  assert.equal(reviewControls("Build spec").length, 1, "the marked row keeps its control");
  assert.equal(reviewControls("Audit notes").length, 0, "an unmarked row would only produce a server refusal");
  assert.deepEqual(toggles, [], "rendering offers no action on its own");
});

test("review={null} renders no review control on any row", () => {
  showRows({ marks: new Map([[ALPHA_PATH, { reviewed: false, stale: false }]]), withReview: false });
  rowButton("Build spec");
  rowButton("Audit notes");
  assert.equal(reviewControls("Build spec").length, 0, "an archived card offers no mark");
  assert.equal(reviewControls("Audit notes").length, 0, "an archived card offers no mark on siblings either");
  assert.equal(screen.queryAllByRole("button", { name: /^(Mark reviewed|Reviewed|Review again|Clear the stale reviewed mark): / }).length, 0);
});

test("pendingPath disables that row's primary control and only that row's", () => {
  const toggles = showRows({
    marks: new Map([
      [ALPHA_PATH, { reviewed: false, stale: false }],
      [BETA_PATH, { reviewed: false, stale: false }],
    ]),
    pendingPath: ALPHA_PATH,
  });
  // The pending label is the implementation's to choose; the requirement is
  // that the primary control of that one row no longer accepts a click.
  const pending = screen.getByRole("button", { name: /^(Mark reviewed|Saving…): Build spec$/ });
  assert.equal(pending.disabled, true, "a row waiting on the server cannot be clicked twice");
  const idle = screen.getByRole("button", { name: "Mark reviewed: Audit notes" });
  assert.equal(idle.disabled, false, "pendingPath names one row, not the whole inventory");
  fireEvent.click(pending);
  assert.deepEqual(toggles, [], "a disabled control never reaches onToggle");
});

console.log("artifact-review-ui: ok");
