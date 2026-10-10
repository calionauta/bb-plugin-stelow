import assert from "node:assert/strict";
import { contrastPickOptions } from "../lib/interface-pick-options.mjs";

const BOX_DRAWING = ["┌", "┐", "└", "┘", "─", "│", "├", "┤", "┬", "┴", "┼", "═", "║"];

function baseReceipt(overrides = {}) {
  return {
    schemaVersion: 1,
    receiptId: "receipt-pick-1",
    route: "interface-refinement",
    briefStatus: "generation-ready",
    authority: "agent",
    disposition: "continue",
    shapeVersion: "v3",
    scopeMapVersion: "map-v1",
    decisionQuestion: "Which queue layout helps the operator act?",
    primaryDimension: "retained context",
    fixedConstraints: [{ name: "safety", value: "warn before commit", source: "simulation" }],
    criteria: ["scan cost", "accessibility"],
    evidence: [
      { source: "simulation", reference: "queue-case", claim: "split view reduces reopen cost" },
    ],
    options: [
      {
        id: "split-view",
        primaryValue: "split context view",
        relatedValues: ["ghost whole"],
        compatibility: "valid",
        scopeCoverage: [
          { scopeId: "checkout", effect: "served", note: "keeps flow in one scope" },
          { scopeId: "offline", effect: "friction", note: "needs a cache scope" },
        ],
      },
      {
        id: "single-view",
        primaryValue: "single dense list",
        relatedValues: [],
        compatibility: "valid",
      },
    ],
    nextAction: "Present both options at the Interface gate.",
    ...overrides,
  };
}

function hasRecommendationKey(value) {
  if (Array.isArray(value)) return value.some(hasRecommendationKey);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(([k, v]) => k.toLowerCase().includes("recommend") || hasRecommendationKey(v));
  }
  if (typeof value === "string") return value.toLowerCase().includes("recommend");
  return false;
}

// 1. Faithful 2-option receipt passes with correct mapping.
{
  const out = contrastPickOptions(baseReceipt());
  assert.equal(out.refused, undefined, "pickable receipt must not refuse");
  assert.ok(Array.isArray(out.options), "pickable receipt returns options array");
  assert.equal(out.options.length, 2, "both eligible options map through");
  const [a, b] = out.options;
  assert.equal(a.label, "split-view", "label is option.id verbatim");
  assert.equal(b.label, "single-view", "label is option.id verbatim");
  assert.ok(a.label.length <= 60 && b.label.length <= 60, "labels respect 60-char ask cap");
  assert.ok(a.description.includes("split context view"), "description names primaryValue");
  assert.ok(a.description.includes("checkout"), "description names served scope id");
  assert.ok(a.description.includes("offline"), "description names friction scope id");
  assert.ok(/served/i.test(a.description) && /friction/i.test(a.description), "description states coverage effects");
  assert.ok(/no map/i.test(b.description), "option without coverage states explicitly no map exists");
  assert.ok(!b.description.includes("checkout"), "no invented coverage on the unmapped option");
  for (const opt of out.options) {
    assert.equal(typeof opt.preview, "string", "preview is a string");
    assert.ok(opt.preview.length > 0, "preview is non-empty");
    const rows = opt.preview.split("\n");
    assert.ok(rows.length <= 15, `preview capped at 15 rows, got ${rows.length}`);
    assert.ok(opt.preview.includes("split context view") || opt.preview.includes("single dense list"), "preview built from receipt primaryValue");
    for (const glyph of BOX_DRAWING) {
      assert.ok(!opt.preview.includes(glyph), `preview must not invent wireframe glyph ${glyph}`);
    }
  }
  assert.deepEqual(a.artifact, { path: "interfaces/interfaces.md", display: "interfaces.md" }, "default artifact path with basename display");
  assert.equal(hasRecommendationKey(out), false, "no recommendation field anywhere in pickable output");
}

// Custom artifactPath override.
{
  const out = contrastPickOptions(baseReceipt(), { artifactPath: "custom/dir/proposal.md" });
  assert.ok(Array.isArray(out.options), "custom artifact receipt still pickable");
  for (const opt of out.options) {
    assert.deepEqual(opt.artifact, { path: "custom/dir/proposal.md", display: "proposal.md" }, "artifact display is basename of path");
  }
  assert.equal(hasRecommendationKey(out), false, "no recommendation with custom artifact");
}

// lean-single-proposal is also pickable.
{
  const out = contrastPickOptions(baseReceipt({ route: "lean-single-proposal" }));
  assert.ok(Array.isArray(out.options) && out.options.length === 2, "lean-single-proposal maps options");
  assert.equal(hasRecommendationKey(out), false, "no recommendation on lean route");
}

// 2. Stub / bad input refuses without throwing.
{
  for (const bad of [null, undefined, "nope", {}, { route: "interface-refinement" }]) {
    const out = contrastPickOptions(bad);
    assert.equal(out.refused, true, `bad input ${JSON.stringify(bad)?.slice(0, 30)} must refuse`);
    assert.equal(typeof out.reason, "string", "refusal carries a reason");
    assert.ok(out.reason.length > 0, "refusal reason is non-empty");
    assert.ok(!Array.isArray(out.options), "refusal never carries options");
    assert.equal(hasRecommendationKey(out), false, "no recommendation in refusal");
  }
}

// 3. Five options refuses (validator allows 1-4).
{
  const five = baseReceipt({
    options: ["a-one", "a-two", "a-three", "a-four", "a-five"].map((id) => ({
      id,
      primaryValue: `value ${id}`,
      compatibility: "valid",
    })),
  });
  const out = contrastPickOptions(five);
  assert.equal(out.refused, true, "5 options must refuse");
  assert.ok(out.reason.length > 0, "5-option refusal names a reason");
  assert.ok(Array.isArray(out.issues) && out.issues.length > 0, "invalid receipt refusal carries issues");
  assert.ok(!Array.isArray(out.options), "invalid receipt never returns options");
}

// 4. Over-long id (>60 chars) refuses the whole receipt, fail-closed.
{
  const longId = `x-${"a".repeat(60)}`;
  assert.ok(longId.length > 60, "fixture id really exceeds 60 chars");
  const receipt = baseReceipt({
    options: [{ id: longId, primaryValue: "some value", compatibility: "valid" }],
  });
  const out = contrastPickOptions(receipt);
  assert.equal(out.refused, true, "over-long id refuses the receipt");
  assert.ok(out.reason.length > 0, "over-long id refusal has a reason");
  assert.ok(!Array.isArray(out.options), "over-long id never returns options");
}

// 5. stop-and-name-decision refuses with destination "human".
{
  const receipt = baseReceipt({
    route: "stop-and-name-decision",
    briefStatus: "stop",
    disposition: "human-decision-required",
    decisionQuestion: null,
    primaryDimension: null,
    criteria: [],
    options: [],
  });
  const out = contrastPickOptions(receipt);
  assert.equal(out.refused, true, "stop-and-name-decision is not pickable");
  assert.equal(out.destination, "human", "stop route destination is human");
  assert.ok(
    out.reason.includes("stop-and-name-decision") || out.reason.includes("human-decision-required"),
    "refusal reason names route/disposition",
  );
  assert.ok(!Array.isArray(out.options), "stop refusal never returns options");
  assert.equal(hasRecommendationKey(out), false, "no recommendation in stop refusal");
}

// 6. repair-brief refuses.
{
  const receipt = baseReceipt({
    route: "repair-brief",
    briefStatus: "repair-brief",
    disposition: "repair-brief",
    decisionQuestion: null,
    primaryDimension: null,
    criteria: [],
    options: [],
  });
  const out = contrastPickOptions(receipt);
  assert.equal(out.refused, true, "repair-brief is not pickable");
  assert.equal(out.destination, "interface", "repair-brief destination follows the route table");
  assert.ok(
    out.reason.includes("repair-brief"),
    "repair-brief refusal reason names route/disposition",
  );
  assert.ok(!Array.isArray(out.options), "repair refusal never returns options");
}

// 7. existing-interface-no-comparison refuses naming adopt-existing.
{
  const receipt = baseReceipt({
    route: "existing-interface-no-comparison",
    briefStatus: "no-comparison",
    disposition: "continue",
    decisionQuestion: null,
    primaryDimension: null,
    criteria: [],
    options: [],
  });
  const out = contrastPickOptions(receipt);
  assert.equal(out.refused, true, "existing-interface-no-comparison is not pickable");
  assert.ok(/adopt-existing/i.test(out.reason), "refusal reason names adopt-existing");
  assert.equal(out.destination, "interface", "existing-interface destination follows the route table");
  assert.ok(!Array.isArray(out.options), "single existing interface never becomes a pick");
}

// 8. Preview row cap enforced under pressure.
{
  const receipt = baseReceipt({
    criteria: ["c-one", "c-two", "c-three", "c-four"],
    options: [
      {
        id: "opt-big",
        primaryValue: "a very long primary value describing the big option",
        relatedValues: ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"],
        compatibility: "valid",
        scopeCoverage: [
          { scopeId: "s1", effect: "served", note: "note one" },
          { scopeId: "s2", effect: "served", note: "note two" },
          { scopeId: "s3", effect: "friction", note: "note three" },
          { scopeId: "s4", effect: "friction", note: "note four" },
        ],
      },
    ],
  });
  const out = contrastPickOptions(receipt);
  assert.ok(Array.isArray(out.options) && out.options.length === 1, "single pressured option stays pickable");
  const rows = out.options[0].preview.split("\n");
  assert.ok(rows.length <= 15, `pressured preview still capped at 15 rows, got ${rows.length}`);
  for (const glyph of BOX_DRAWING) {
    assert.ok(!out.options[0].preview.includes(glyph), `pressured preview invents no glyph ${glyph}`);
  }
}

// 9. Non-pickable brief/disposition on a pickable route refuses (shape-contrast stub).
// The stub pair is valid for its own route (destination resolves to "shape"), so
// the refusal comes from the pickable-route set, not the validator — paired with
// the interface-refinement twin below, the route set is what decides.
{
  const receipt = baseReceipt({
    route: "shape-contrast",
    briefStatus: "stop",
    disposition: "shape-required",
    decisionQuestion: null,
    primaryDimension: null,
    criteria: [],
    options: [],
  });
  const out = contrastPickOptions(receipt);
  assert.equal(out.refused, true, "shape-contrast stub refuses");
  assert.equal(out.destination, "shape", "stub refusal destination follows the route table");
  assert.ok(out.reason.length > 0, "stub refusal names a reason");
  assert.ok(out.reason.includes("shape-contrast"), "stub refusal names the route, not just the pair");
  assert.ok(!Array.isArray(out.options), "stub refusal never returns options");
  const twin = contrastPickOptions(baseReceipt());
  assert.equal(twin.refused, undefined, "interface-refinement twin with a pickable pair maps");
  assert.ok(Array.isArray(twin.options) && twin.options.length === 2, "twin returns both options, so the route set decides");
}

// 10. Pickable route with empty options refuses. The validator 1-4 rule fires
// first here, so pin only the refusal — not which layer refuses.
{
  const receipt = baseReceipt({ options: [] });
  const out = contrastPickOptions(receipt);
  assert.equal(out.refused, true, "empty options on a pickable route refuses");
  assert.ok(typeof out.reason === "string" && out.reason.length > 0, "empty-options refusal names a reason");
  assert.ok(!Array.isArray(out.options), "empty-options refusal never returns options");
}

console.log("interface pick options test ok: mapping, refusals, caps, no-wireframe, no-recommendation");
