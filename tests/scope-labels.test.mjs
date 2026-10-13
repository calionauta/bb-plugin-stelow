import assert from "node:assert/strict";
import { applyScopeLabels, labelDetailQuestions, replaceScopeIds, scopeTitleIndex } from "../lib/scope-labels.mjs";

// Title precedence: title beats name beats outcome.
const precedence = scopeTitleIndex([
  { id: "A5", title: "Keep", name: "Name wins?", outcome: "Outcome wins?" },
  { id: "S1", name: "Scope name", outcome: "Outcome loses" },
  { id: "S2", outcome: "Only outcome" },
]);
assert.equal(precedence.get("A5"), "Keep", "title wins over name and outcome");
assert.equal(precedence.get("S1"), "Scope name", "name wins over outcome");
assert.equal(precedence.get("S2"), "Only outcome", "outcome is used when it is all there is");

// Entries without an id, or without any usable display text, are skipped.
const sparse = scopeTitleIndex([
  { title: "No id at all" },
  { id: "", title: "Empty id" },
  { id: "   ", title: "Blank id" },
  { id: "X1" },
  { id: "X2", title: "   " },
  { id: null, title: "Null id" },
  null,
  "A5",
]);
assert.equal(sparse.size, 0, "entries without an id or display text are skipped");

// First entry wins on duplicate ids; ids and titles are trimmed.
const dupes = scopeTitleIndex([
  { id: "A1", title: "First" },
  { id: "A1", title: "Second" },
  { id: "  A2  ", title: "  Padded  " },
]);
assert.equal(dupes.get("A1"), "First", "the first entry wins on duplicate ids");
assert.equal(dupes.get("A2"), "Padded", "ids and titles are trimmed");
assert.ok(!dupes.has("  A2  "), "the untrimmed id is not kept as a key");

// Non-array input builds an empty index instead of throwing.
for (const input of [null, undefined, "A5", 42, { id: "A5", title: "Keep" }]) {
  assert.equal(scopeTitleIndex(input).size, 0, `non-array input builds an empty index (${String(input)})`);
}

// Whole-word replacement: A5 maps, A1 never matches inside A10.
const words = new Map([["A5", "Keep"], ["A1", "One"]]);
assert.equal(replaceScopeIds("Ship A5 now", words), "Ship Keep now", "a standalone id renders as its title");
assert.equal(replaceScopeIds("Keep A5 IN?", words), "Keep Keep IN?", "ids next to punctuation still match");
assert.equal(replaceScopeIds("A10 ships", words), "A10 ships", "A1 does not match inside A10");
assert.equal(replaceScopeIds("XA5 ships", words), "XA5 ships", "an id glued to a prefix does not match");

// Longest-first: with overlapping ids the longer one must win.
const overlap = new Map([["A1", "One"], ["A10", "Ten"]]);
assert.equal(replaceScopeIds("A10 and A1", overlap), "Ten and One", "overlapping ids resolve longest-first");

// Unknown ids pass through untouched; they are data, not errors.
assert.equal(replaceScopeIds("Ship A99 now", words), "Ship A99 now", "unknown ids pass through untouched");

// Non-string input passes through by identity; an empty index returns the text as-is.
assert.equal(replaceScopeIds(42, words), 42, "non-string input passes through");
assert.equal(replaceScopeIds(null, words), null, "null input passes through");
assert.equal(replaceScopeIds("Ship A5 now", new Map()), "Ship A5 now", "an empty index returns input unchanged");
assert.equal(replaceScopeIds("Ship A5 now", {}), "Ship A5 now", "a non-Map index returns input unchanged");

// Replacement text with $ patterns must not corrupt the output.
const tricky = new Map([["A5", "Cost $& and $' done"]]);
assert.equal(replaceScopeIds("Do A5 please", tricky), "Do Cost $& and $' done please", "dollar patterns in titles are literal");

// applyScopeLabels maps question plus option label/description/preview.
const labeled = applyScopeLabels(
  {
    question: "Ship A5 or A10?",
    options: [{ id: "o1", label: "Pick A5", description: "Keeps A1 safe", preview: "Preview of A10", extra: 7 }],
  },
  new Map([["A5", "Keep"], ["A10", "Ten"], ["A1", "One"]]),
);
assert.equal(labeled.question, "Ship Keep or Ten?", "the question text renders titles");
assert.equal(labeled.options[0].label, "Pick Keep", "option labels render titles");
assert.equal(labeled.options[0].description, "Keeps One safe", "option descriptions render titles");
assert.equal(labeled.options[0].preview, "Preview of Ten", "option previews render titles");
assert.equal(labeled.options[0].id, "o1", "option ids are preserved");
assert.equal(labeled.options[0].extra, 7, "all other option keys are preserved");

// preview:null stays null; missing options leave the question intact.
const nullPreview = applyScopeLabels({ question: "Do A5?", options: [{ id: "o1", preview: null }] }, words);
assert.equal(nullPreview.options[0].preview, null, "a null preview stays null");
const bare = applyScopeLabels({ question: "Do A5?", id: "q1" }, words);
assert.equal(bare.question, "Do Keep?", "questions without options still map");
assert.equal(bare.id, "q1", "question keys are preserved");

// Non-object options entries pass through; non-object questions pass through.
const mixed = applyScopeLabels({ question: "Do A5?", options: [null, "Pick A5", 42, { id: "o2", label: "Go A5" }] }, words);
assert.deepEqual(mixed.options.slice(0, 3), [null, "Pick A5", 42], "non-object options entries pass through");
assert.equal(mixed.options[3].label, "Go Keep", "object entries beside them still map");
assert.equal(applyScopeLabels(null, words), null, "a null question passes through");
assert.equal(applyScopeLabels("Do A5?", words), "Do A5?", "a string question passes through");

// labelDetailQuestions combines xray nodes, draft nodes, and tracking scopes with first-title-wins.
const detail = labelDetailQuestions(
  [{ id: "q1", question: "Ship A5 or D1 or S9?" }],
  [{ id: "q2", question: "Retire A5?" }],
  { nodes: [{ id: "A5", title: "Checkout flow" }] },
  { nodes: [{ id: "D1", title: "Draft only" }] },
  [{ id: "A5", name: "Wrong name" }, { id: "S9", name: "Tracking nine" }],
);
assert.equal(detail.pending[0].question, "Ship Checkout flow or Draft only or Tracking nine?", "xray plus draft plus scopes resolve together");
assert.equal(detail.expired[0].question, "Retire Checkout flow?", "the xray title wins over the later tracking scope name");
assert.equal(detail.pending[0].id, "q1", "question keys survive detail labeling");
assert.deepEqual(Object.keys(detail).sort(), ["expired", "pending"], "the detail result keeps pending and expired keys");

// Draft-only ids resolve with no xray and no tracking scopes.
const draftOnly = labelDetailQuestions([{ question: "Do D2?" }], [], null, { nodes: [{ id: "D2", title: "Draft two" }] }, null);
assert.equal(draftOnly.pending[0].question, "Do Draft two?", "a draft-only id resolves without xray or scopes");
assert.deepEqual(draftOnly.expired, [], "an empty expired list stays empty");

// Unknown ids pass through untouched in both lists.
const unknown = labelDetailQuestions([{ question: "Ship A99?" }], [{ question: "Hold Z12?" }], { nodes: [] }, null, []);
assert.equal(unknown.pending[0].question, "Ship A99?", "unknown pending ids pass through");
assert.equal(unknown.expired[0].question, "Hold Z12?", "unknown expired ids pass through");

// Non-array pending/expired yield empty arrays without throwing.
for (const input of [null, undefined, "q1", 42]) {
  const empty = labelDetailQuestions(input, input, null, null, null);
  assert.deepEqual(empty, { pending: [], expired: [] }, `non-array detail input yields empty arrays (${String(input)})`);
}

console.log("scope labels test ok: index precedence, whole-word longest-first replacement, and labeled questions");
