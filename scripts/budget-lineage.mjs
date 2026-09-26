// Lineage evidence for the source budget gate.
//
// The gate may only call a finding "inherited" when it can point at where the
// debt came from: the same symbol in the same file at a comparison ref, or a
// symbol whose body was moved from somewhere else. A move is proven by a long
// contiguous run of identical tokens — the code travelled. Lexical similarity
// is not lineage: two unrelated functions written in the same vocabulary score
// well against each other, and a similarity match alone must never waive a
// budget violation. Debt with no lineage is not waived here either; it has to
// be recorded in scripts/source-debt.json, where the record is reviewed.

export const lineageTokens = 20;
const anchorTokens = 8;
const tokenPattern = /[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`|\S/g;

// Word-ish tokens, numbers, literals, and punctuation, minus the escape
// backslashes the string patterns leave behind. Identical tokenizer width to
// the one the debt census uses, so a run means the same thing in both gates.
export function tokenList(text) {
  return (text.match(tokenPattern) ?? []).filter((token) => token !== "\\");
}

// The identifier a debt ledger and the census both key on. The ordinal is only
// written when a label repeats inside its parent, so `writeBundle` and
// `callback#4` are the two shapes in use.
export function censusKey(record) {
  const path = record.path.join("/");
  return `${record.file}:${path}${record.ordinal > 1 ? `#${record.ordinal}` : ""}`;
}

function anchorIndex(tokens) {
  const anchors = new Map();
  for (let start = 0; start + anchorTokens <= tokens.length; start += 1) {
    const gram = tokens.slice(start, start + anchorTokens).join("\u0000");
    if (!anchors.has(gram)) anchors.set(gram, start);
  }
  return anchors;
}

// The longest run of consecutive identical tokens in both token lists. Indexes
// the shorter side by anchor, then extends each hit, so the cost is linear in
// the longer side rather than quadratic. An exact copy returns that side's full
// length and stops the scan.
export function longestSharedRun(left, right) {
  if (left.length > right.length) [left, right] = [right, left];
  if (left.length < anchorTokens) return 0;
  const anchors = anchorIndex(left);
  let best = 0;
  for (let start = 0; start + anchorTokens <= right.length; start += 1) {
    const offset = anchors.get(right.slice(start, start + anchorTokens).join("\u0000"));
    if (offset === undefined) continue;
    let run = anchorTokens;
    while (offset + run < left.length && start + run < right.length
      && left[offset + run] === right[start + run]) run += 1;
    if (run > best) best = run;
    if (best === left.length) break;
  }
  return best;
}

export function provesMove(left, right) {
  return longestSharedRun(left, right) >= lineageTokens;
}

// How many leading path segments two records share, normalized. Used only to
// pick between candidates that are already proven, never to prove one.
export function pathAffinity(left, right) {
  let shared = 0;
  const width = Math.min(left.length, right.length);
  for (let index = 0; index < width; index += 1) {
    if (left[index] !== right[index]) break;
    shared += 1;
  }
  return shared / Math.max(left.length, right.length);
}
