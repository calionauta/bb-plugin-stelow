import assert from "node:assert/strict";
import { answerMentionsSplit } from "../lib/split-proposal.mjs";

// Pins the freeform detector behind the standard-ask reminder: only a
// standalone "split" counts, so the direct formal-split sentence fires on a
// decision ("Propose split") and never on prose that merely contains the
// letters ("resplit") or a gerund ("splitting" — \b sits between word chars).
assert.equal(answerMentionsSplit({ answers: ["Propose split"] }), true, "propose-split wording counts");
assert.equal(answerMentionsSplit({ answers: ["Split A and B"] }), true, "split with slices counts");
assert.equal(answerMentionsSplit({ answers: ["please SPLIT this card"] }), true, "the match is case-insensitive");
assert.equal(answerMentionsSplit({ answers: ["Keep as one card"] }), false, "keep is not a split mention");
assert.equal(answerMentionsSplit({ answers: ["splitting this card"] }), false, "gerund is not a standalone split");
assert.equal(answerMentionsSplit({ answers: ["let us resplit the work"] }), false, "split inside another word is not a decision");
assert.equal(answerMentionsSplit({ answers: ["scope A", 42, null, { text: "split" }] }), false, "non-string entries never count");
assert.equal(answerMentionsSplit(null), false, "null value has no answers");
assert.equal(answerMentionsSplit(undefined), false, "undefined value has no answers");
assert.equal(answerMentionsSplit("split"), false, "a non-object value has no answers");
assert.equal(answerMentionsSplit([]), false, "an array value is not the outcome shape");
assert.equal(answerMentionsSplit({}), false, "missing answers is not a mention");
assert.equal(answerMentionsSplit({ answers: "split" }), false, "non-array answers is not a mention");
assert.equal(answerMentionsSplit({ answers: [] }), false, "empty answers is not a mention");

console.log("split mention test ok: standalone split only, gerunds and substrings excluded");
