import assert from "node:assert/strict";
import {
  attachOptionFlag,
  cleanOptions,
  parseAskGroups,
} from "../lib/question-batch.mjs";
import { submitBlockReason } from "../lib/question-presentation.mjs";

// --needs-note: conditional options block submit until the note box carries
// the missing piece. Lib-level contract: parse, clean, gate.

const q = (id, options) => ({ id, options });

// --- parseAskGroups ---

// --option A --needs-note marks that option conditional.
{
  const out = parseAskGroups(["--question", "Q", "--option", "A", "--needs-note", "--option", "B"]);
  assert.ok(!out.error, `parses cleanly, got: ${out.error}`);
  assert.equal(out.groups[0].options[0].needsNote, true, "first option carries needsNote");
  assert.ok(!("needsNote" in out.groups[0].options[1]), "untagged sibling stays plain");
}

// --needs-note with no preceding --option refuses, naming the flag.
{
  const bare = parseAskGroups(["--question", "Q", "--needs-note", "--option", "A", "--option", "B"]);
  assert.ok(bare.error && bare.error.includes("--needs-note"), "names the flag when no option precedes it");
  const leading = parseAskGroups(["--needs-note"]);
  assert.ok(leading.error && leading.error.includes("--needs-note"), "leading flag also names itself");
}

// Usage text documents the flag.
{
  const usage = parseAskGroups([]);
  assert.ok(usage.error && usage.error.includes("--needs-note"), "usage mentions --needs-note");
}

// --- attachOptionFlag directly ---

// Attaches to the last option of the last group.
{
  const groups = [
    { question: "Q1", multiple: false, options: [{ label: "A" }] },
    { question: "Q2", multiple: false, options: [{ label: "B" }, { label: "C" }] },
  ];
  assert.equal(attachOptionFlag(groups, "--needs-note"), null, "lands cleanly");
  assert.equal(groups[1].options[1].needsNote, true, "last option of last group is tagged");
  assert.ok(!("needsNote" in groups[1].options[0]), "sibling untouched");
  assert.ok(!("needsNote" in groups[0].options[0]), "earlier group untouched");
}

// Empty groups refuse, naming the flag.
{
  assert.ok(attachOptionFlag([], "--needs-note").includes("--needs-note"), "empty groups name the flag");
  const noOption = [{ question: "Q", multiple: false, options: [] }];
  assert.ok(attachOptionFlag(noOption, "--needs-note").includes("--needs-note"), "option-less group names the flag");
}

// --selected vs --needs-note map to their own fields.
{
  const groups = [{ question: "Q", multiple: true, options: [{ label: "A" }, { label: "B" }] }];
  assert.equal(attachOptionFlag(groups, "--selected"), null, "selected lands");
  assert.equal(groups[0].options[1].selected, true, "--selected sets selected");
  assert.ok(!("needsNote" in groups[0].options[1]), "--selected does not set needsNote");
  assert.equal(attachOptionFlag(groups, "--needs-note"), null, "needs-note lands");
  assert.equal(groups[0].options[1].needsNote, true, "--needs-note sets needsNote");
  assert.equal(groups[0].options[1].selected, true, "both flags coexist on one option");
}

// --- cleanOptions ---

// Explicit true travels.
{
  const [kept] = cleanOptions([{ label: "Trim it", needsNote: true }]);
  assert.equal(kept.needsNote, true, "explicit true travels");
}

// Absent / false / malformed never travel.
{
  const [absent] = cleanOptions([{ label: "Plain" }]);
  assert.ok(!("needsNote" in absent), "absent flag stays absent");
  const [no] = cleanOptions([{ label: "Plain", needsNote: false }]);
  assert.ok(!("needsNote" in no), "false stays absent");
  for (const bad of ["yes", 1, "true", {}, []]) {
    const [entry] = cleanOptions([{ label: "Plain", needsNote: bad }]);
    assert.ok(!("needsNote" in entry), `malformed needsNote (${JSON.stringify(bad)}) stays absent`);
  }
}

// Other fields survive alongside the flag.
{
  const [entry] = cleanOptions([{
    label: "Trim it",
    description: "Say which.",
    preview: "preview text",
    artifact: "docs/plan.md",
    selected: true,
    needsNote: true,
  }]);
  assert.equal(entry.label, "Trim it", "label intact");
  assert.equal(entry.description, "Say which.", "description intact");
  assert.equal(entry.preview, "preview text", "preview intact");
  assert.deepEqual(entry.artifact, { path: "docs/plan.md", display: "plan.md" }, "artifact intact");
  assert.equal(entry.selected, true, "selected intact");
  assert.equal(entry.needsNote, true, "needsNote intact");
}

// --- submitBlockReason ---

const BLOCK = "This pick needs a note";
const conditional = [{ label: "Approve as written" }, { label: "Approve, but trim the scope", needsNote: true }];

// Picked conditional + empty note blocks.
{
  const reason = submitBlockReason([q("q1", conditional)], { q1: ["Approve, but trim the scope"] }, { q1: "" });
  assert.ok(typeof reason === "string" && reason.includes(BLOCK), "picked conditional with empty note blocks");
}

// Picked conditional + note text passes.
{
  const picked = { q1: ["Approve, but trim the scope"] };
  assert.equal(submitBlockReason([q("q1", conditional)], picked, { q1: "Trim to Q1." }), null, "note text unblocks");
  assert.equal(submitBlockReason([q("q1", conditional)], picked, { q1: "   padded   " }), null, "whitespace-padded note unblocks");
}

// Unpicked conditional passes.
{
  assert.equal(submitBlockReason([q("q1", conditional)], { q1: ["Approve as written"] }, { q1: "" }), null, "unpicked conditional passes");
}

// Plain options pass with or without a note.
{
  const plain = [{ label: "Yes" }, { label: "No" }];
  assert.equal(submitBlockReason([q("q1", plain)], { q1: ["Yes"] }, { q1: "" }), null, "plain pick passes");
  assert.equal(submitBlockReason([q("q1", plain)], { q1: ["Yes"] }, { q1: "extra" }), null, "plain pick with note passes");
}

// Empty / skipped semantics: no picks means nothing conditional is picked.
{
  assert.equal(submitBlockReason([q("q1", conditional)], { q1: [] }, { q1: "" }), null, "empty pick list passes");
  assert.equal(submitBlockReason([q("q1", conditional)], {}, {}), null, "missing state passes (skip clears picks upstream)");
}

// Non-array inputs never throw, always pass.
{
  for (const questions of [null, undefined, "q", 42, {}]) {
    assert.equal(submitBlockReason(questions, { q1: ["Approve, but trim the scope"] }, { q1: "" }), null, `questions=${String(questions)} passes`);
  }
  for (const selected of [null, undefined, [], "x", 42]) {
    assert.equal(submitBlockReason([q("q1", conditional)], selected, { q1: "" }), null, "non-object selected passes");
  }
  for (const custom of [null, undefined, [], "x", 42]) {
    assert.ok(
      (submitBlockReason([q("q1", conditional)], { q1: ["Approve, but trim the scope"] }, custom) ?? "").includes(BLOCK),
      "non-object custom reads as an empty note, so a picked conditional still blocks",
    );
    assert.equal(submitBlockReason([q("q1", conditional)], { q1: ["Approve as written"] }, custom), null, "non-object custom blocks nothing unpicked");
  }
  assert.equal(submitBlockReason([null, "x", 42, q("q1", conditional)], { q1: ["Approve as written"] }, {}), null, "malformed entries are skipped");
}

// Blocked question is found across a batch, not just the first entry.
{
  const questions = [q("q1", [{ label: "Yes" }, { label: "No" }]), q("q2", conditional)];
  const reason = submitBlockReason(questions, { q1: ["Yes"], q2: ["Approve, but trim the scope"] }, { q1: "", q2: "" });
  assert.ok(typeof reason === "string" && reason.includes(BLOCK), "second blocked question still blocks");
}

console.log("question-needs-note: ok");
