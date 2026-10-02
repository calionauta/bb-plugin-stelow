import assert from "node:assert/strict";
import { join } from "node:path";
import { findElementByClass, loadComponent, root, walk } from "./helpers/render-component.mjs";

/**
 * The preset list's row: how a worktree preset is told apart without opening it.
 *
 * RENDERED, not grepped. The previous assertion matched source text with a
 * non-greedy `</span>\s*\{preset\.isDefault`, which a pill nested INSIDE the
 * truncating span sails straight through — verified, that mutation left the
 * whole suite green, and a pill that is never seen shipping green is the exact
 * failure this file exists to prevent.
 */

const PRESET = {
  id: "p1",
  name: "Reviewer",
  providerId: "anthropic",
  modelId: "claude",
  reasoningLevel: "high",
  permissionMode: "ask",
  environmentKind: "project-default",
  builtIn: false,
  isDefault: false,
};

/** The row's Pill, found by the word it renders — how a reader finds it. */
function findPill(node, word) {
  let found = null;
  walk(node, (current) => {
    if (!found && current.type === "pill" && current.children?.[0] === word) found = current;
  });
  return found;
}

function loadPresetRow() {
  // JSX passes children as the third argument to a component element.
  const Pill = (props, ...children) => ({ type: "pill", props, children });
  return loadComponent(
    "components/settings/preset-manager-preset-row.tsx",
    "PresetManagerPresetRow",
    {
      "../dashboard/build-status-pills": { Pill },
      "@/components/ui/button": {
        Button: (props, ...children) => ({ type: "button", props, children }),
      },
      "./preset-manager-types": {},
    },
  );
}

const row = loadPresetRow();
const render = (preset) =>
  row({ preset, busy: false, onEdit: () => {}, onSetDefault: () => {}, onDelete: () => {} });
const worktree = render({ ...PRESET, environmentKind: "new-worktree" });

assert.ok(findPill(worktree, "worktree"), "a worktree preset is marked in the list");
assert.equal(
  findPill(render({ ...PRESET, environmentKind: "project-default" }), "worktree"),
  null,
  "and only a worktree preset carries it, so absence reads as 'not a worktree'",
);

// The structural guarantee: the indicator is a sibling of the truncating meta
// span, because anything inside that span is ellipsised and never renders.
const truncating = findElementByClass(worktree, "truncate");
assert.ok(truncating, "the row still truncates its meta line");
assert.equal(
  findPill(truncating, "worktree"),
  null,
  "the indicator is a sibling of the truncating meta span, never inside it",
);

console.log(
  "preset environment row ok: a worktree preset is marked in the list, and the "
  + "marker is a sibling of the truncating span so it actually renders",
);
