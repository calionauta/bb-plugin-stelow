import assert from "node:assert/strict";
import test from "node:test";
import {
  describePresetDeleteImpact,
  presetDeleteDescription,
} from "../lib/preset-delete-refs.mjs";

/**
 * What a preset delete takes with it, as the confirm dialog names it.
 *
 * EXECUTED, not read out of the shell: both functions are pure, so every
 * claim below is a fact about a return value. The dialog in
 * `preset-manager-shell.tsx` stays thin and calls these; a dialog that
 * stopped asking — or a lib edit that dropped a role, reworded the join, or
 * silenced the card-assignment note — fails here rather than shipping a
 * confirm that understates the blast radius.
 */

test("no pins, roles, or default means nothing cascades and nothing is refused", () => {
  for (const assignments of [undefined, {}, { bands: [] }]) {
    assert.deepEqual(
      describePresetDeleteImpact("p1", assignments),
      { cascading: [], isDefault: false },
      "an unreferenced preset deletes cleanly, however empty the input",
    );
  }
});

test("pins to other presets are not the deleted preset's problem", () => {
  assert.deepEqual(
    describePresetDeleteImpact("p1", {
      bands: [{ band: "execution", presetId: "p2" }],
      generationPreset: { id: "p2" },
      reliablePreset: { id: "p2" },
      reviewerPreset: { id: "p2" },
    }),
    { cascading: [], isDefault: false },
    "references that point elsewhere change nothing about this delete",
  );
});

test("one band pin is named, and only the matching band", () => {
  assert.deepEqual(
    describePresetDeleteImpact("p1", {
      bands: [
        { band: "execution", presetId: "p1" },
        { band: "research", presetId: "p2" },
        null,
      ],
    }),
    { cascading: ['band "execution"'], isDefault: false },
    "the pinned band is named; other bands and empty rows are ignored",
  );
});

test("each singleton role is named on its own", () => {
  assert.deepEqual(
    describePresetDeleteImpact("p1", { generationPreset: { id: "p1" } }).cascading,
    ["draft-generation preset"],
    "the generation role cascades with the row",
  );
  assert.deepEqual(
    describePresetDeleteImpact("p1", { reliablePreset: { id: "p1" } }).cascading,
    ["reliable-tier preset"],
    "the reliable role cascades with the row",
  );
  assert.deepEqual(
    describePresetDeleteImpact("p1", { reviewerPreset: { id: "p1" } }).cascading,
    ["reviewer preset"],
    "the reviewer role cascades with the row — dropping this check understates the delete",
  );
});

test("several pins combine in band order, then roles", () => {
  assert.deepEqual(
    describePresetDeleteImpact("p1", {
      bands: [
        { band: "execution", presetId: "p1" },
        { band: "research", presetId: "p1" },
      ],
      generationPreset: { id: "p1" },
      reliablePreset: { id: "p1" },
      reviewerPreset: { id: "p1" },
    }).cascading,
    [
      'band "execution"',
      'band "research"',
      "draft-generation preset",
      "reliable-tier preset",
      "reviewer preset",
    ],
    "bands keep their routing order and roles follow, so the sentence reads deterministically",
  );
});

test("only a true default flag counts as the default", () => {
  assert.equal(
    describePresetDeleteImpact("p1", { isDefault: true }).isDefault,
    true,
    "the board default is reported",
  );
  for (const isDefault of [undefined, false, 0, 1, "yes"]) {
    assert.equal(
      describePresetDeleteImpact("p1", { isDefault }).isDefault,
      false,
      `a non-true flag (${JSON.stringify(isDefault)}) is not the default, so a truthy test cannot refuse here`,
    );
  }
});

test("an unreferenced preset names only itself and the card-assignment exit", () => {
  assert.equal(
    presetDeleteDescription("Reviewer", { cascading: [], isDefault: false }),
    'Removes the "Reviewer" agent preset. '
      + "Cards already using it must be unassigned first, or the delete is refused and nothing is removed.",
    "the exact sentence for the clean case, so a dropped card note fails here",
  );
});

test("a lone pin is listed as removed with the row, not as a refusal", () => {
  const description = presetDeleteDescription("Worker", {
    cascading: ['band "execution"'],
    isDefault: false,
  });
  assert.match(
    description,
    /It is currently the band "execution" — those assignments are removed with it\./,
    "the confirm names what the delete takes with it",
  );
  assert.doesNotMatch(
    description,
    /board default/,
    "a cascading pin is not described as the default refusal it does not have",
  );
  assert.match(
    description,
    /Cards already using it must be unassigned first, or the delete is refused and nothing is removed\./,
    "the card-assignment exit survives alongside the cascade list",
  );
});

test("several pins read as a joined list", () => {
  const two = presetDeleteDescription("Worker", {
    cascading: ['band "execution"', "reviewer preset"],
    isDefault: false,
  });
  assert.match(
    two,
    /It is currently the band "execution" and reviewer preset — those assignments are removed with it\./,
    "two refs join with 'and' and no comma",
  );
  const three = presetDeleteDescription("Worker", {
    cascading: ['band "execution"', 'band "research"', "reviewer preset"],
    isDefault: false,
  });
  assert.match(
    three,
    /It is currently the band "execution", band "research" and reviewer preset — those assignments are removed with it\./,
    "three refs join with commas and a final 'and'",
  );
});

test("the default refusal names its exit and suppresses the cascade list", () => {
  const description = presetDeleteDescription("Worker", {
    cascading: ['band "execution"', "reviewer preset"],
    isDefault: true,
  });
  assert.match(
    description,
    /It is the board default, so the delete is refused until another preset is set as default\./,
    "the refusal names the exact way out, matching the server's own error",
  );
  assert.doesNotMatch(
    description,
    /currently the/,
    "a refused delete lists no cascade, because nothing is removed",
  );
  assert.doesNotMatch(
    description,
    /removed with it/,
    "and promises no removal the server will not perform",
  );
  assert.match(
    description,
    /Cards already using it must be unassigned first/,
    "the card-assignment note survives the default refusal too",
  );
});

test("the card-assignment note survives every shape", () => {
  const shapes = [
    { cascading: [], isDefault: false },
    { cascading: ['band "execution"'], isDefault: false },
    {
      cascading: ['band "execution"', 'band "research"', "reviewer preset"],
      isDefault: false,
    },
    { cascading: [], isDefault: true },
    { cascading: ['band "execution"'], isDefault: true },
  ];
  for (const impact of shapes) {
    assert.match(
      presetDeleteDescription("Worker", impact),
      /Cards already using it must be unassigned first, or the delete is refused and nothing is removed\./,
      `the dialog never claims a card pin it cannot see (${JSON.stringify(impact)})`,
    );
  }
});
