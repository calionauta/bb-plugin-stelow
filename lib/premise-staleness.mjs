/**
 * Premise staleness: an answer rests on a cell or a line, and both can vanish.
 *
 * A recorded question carries the PREMISE it came from — `cart|paid` for a blank
 * cell, `cart|paid|pay-button` for a shared affordance, or `artifact:<path>:<line>`
 * for a decision that rests on one line of a document. The answer is only an
 * answer while that premise still exists. A rewind that drops the place, the
 * state, or rewrites the artifact leaves the decision in place and takes its
 * ground away, and an answer resting on nothing is a stale decision the next
 * reader will treat as current.
 *
 * Staleness is DERIVED from the premise, never stored as a flag a human has to
 * remember to set — the same discipline as restore-time reactivation
 * (`lib/card-restore-pending.mjs`), which reads the rows the archive wrote and
 * the card's live state instead of trusting a second identity. A stored `stale`
 * column would be wrong the moment anyone edited the matrix and right only for
 * whoever remembered; a comparison made on read cannot be forgotten.
 *
 * The verdict has three values, and the third is the honest one:
 *
 * - `{ stale: true, missing }` — an observed ref is gone. The answer no longer
 *   rests on anything.
 * - `{ stale: false, checked }` — every observed ref survives.
 * - `null` — nothing could be observed (no matrix artifact, no readable file,
 *   an observation the host did not supply). This is NOT "not stale": an
 *   unreadable artifact must never accuse a decision of being stale, and the
 *   card detail read that consumes this must stay advisory.
 *
 * The grammar is the contrast model's, unchanged (`|` separates coordinates,
 * `+` joins premises, `contrast:`-free because a premise is not an id), so a
 * premise can be read back to exactly one cell. Artifact refs are
 * `artifact:<workspace-relative path>:<line>`, and the line is 1-based — the
 * number an editor shows, not an index.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTRAST_ARTIFACT, parseContrastArtifact } from "./contrast-artifact.mjs";

const SEPARATOR = "|";
const JOINER = "+";
const ARTIFACT_PREFIX = "artifact:";
const PENDING_LEVELS = new Set(["low", "medium", "high"]);

function fail(message) {
  throw new Error(`premise: ${message}`);
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * One cell coordinate. The affordance is optional because an empty-cell
 * question's premise is the cell itself — there is no affordance to name, and
 * inventing one would make the ref claim something the matrix never said.
 */
function cellRef(raw) {
  const parts = raw.split(SEPARATOR);
  if (parts.length < 2 || parts.length > 3) {
    fail(`"${raw}" is not a cell reference — a cell premise is place${SEPARATOR}state or place${SEPARATOR}state${SEPARATOR}affordance`);
  }
  if (parts.some((part) => part.trim() === "")) fail(`"${raw}" has an empty coordinate`);
  return {
    kind: "cell",
    place: parts[0],
    state: parts[1],
    affordance: parts.length === 3 ? parts[2] : null,
    raw,
  };
}

/**
 * `artifact:<path>:<line>`. The path may itself contain `:` on exotic systems,
 * so the split is on the LAST colon: the line is the one suffix that can never
 * be part of a filename.
 */
function artifactRef(raw) {
  const rest = raw.slice(ARTIFACT_PREFIX.length);
  const cut = rest.lastIndexOf(":");
  if (cut <= 0) {
    fail(`"${raw}" is not an artifact reference — an artifact premise is artifact:<path>:<line>`);
  }
  const path = rest.slice(0, cut).trim();
  const line = Number(rest.slice(cut + 1));
  if (!path) fail(`"${raw}" names no artifact path`);
  if (!Number.isInteger(line) || line < 1) {
    fail(`"${raw}" does not name a 1-based line — the number an editor shows`);
  }
  return { kind: "artifact", path, line, raw };
}

/**
 * Every ref a premise names. Throws naming the premise when one cannot be read
 * back to a place: a premise that resolves to nothing is worse than no premise,
 * because a reader trusts it.
 */
export function premiseRefs(premise) {
  const value = text(premise);
  if (!value) fail("a premise cannot be empty");
  return value.split(JOINER).map((raw) => {
    const ref = raw.trim();
    if (!ref) fail(`"${premise}" has an empty ref between ${JOINER} separators`);
    return ref.startsWith(ARTIFACT_PREFIX) ? artifactRef(ref) : cellRef(ref);
  });
}

/** True when the string is a premise this module can read. Used at the ask
 * boundary, where an unreadable premise must refuse the question rather than be
 * stored and fail later. */
export function isPremise(premise) {
  try {
    premiseRefs(premise);
    return true;
  } catch {
    return false;
  }
}

/** The reversal-cost shape a recorded question carries: a named level and the
 * sentence that says why. Kept here because both the ask store and the
 * derivation speak it, and two spellings would drift. */
export function isReversalCost(cost) {
  return cost !== null && typeof cost === "object" && !Array.isArray(cost)
    && PENDING_LEVELS.has(cost.level)
    && text(cost.why) !== "";
}

/**
 * Compare a premise with what the card looks like NOW.
 *
 * `observe(ref)` answers `true` (still there), `false` (gone) or `null` (cannot
 * say). The caller injects it so this stays a pure comparison: the test can
 * "rewind" by handing a different matrix, and the card read can hand a
 * filesystem.
 */
export function premiseVerdict(premise, observe) {
  if (typeof observe !== "function") return null;
  let checked = 0;
  const missing = [];
  for (const ref of premiseRefs(premise)) {
    const observed = observe(ref);
    if (observed === null || observed === undefined) continue;
    checked += 1;
    if (!observed) missing.push(ref.raw);
  }
  if (missing.length > 0) return { stale: true, missing, checked };
  return checked > 0 ? { stale: false, missing: [], checked } : null;
}

/**
 * A verdict over recorded answers. Rows arrive from the store
 * (`answeredQuestionPremises`); a legacy row has no premise and therefore no
 * verdict — never a stale one.
 */
export function stalenessOfAnswered(rows, observe) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    verdict: row?.premise ? premiseVerdict(row.premise, observe) : null,
  }));
}

/**
 * The sentence a stale answer leaves on the card. Factual: it names what is
 * gone and what that costs. It never says the decision was wrong — only that
 * its ground is no longer there, which is the reader's business.
 */
export function staleTrailLine(verdict) {
  if (!verdict || verdict.stale !== true) return null;
  const missing = Array.isArray(verdict.missing) ? verdict.missing.join(", ") : "";
  return `Stale decision: its premise no longer exists (${missing}), so this answer `
    + "no longer rests on the matrix or artifact it was asked about — re-derive the question before relying on it.";
}

/** A cell premise holds while the matrix still declares the coordinate: the
 * place, the state, and (when named) the affordance. A filled cell is not a
 * missing cell — filling it is what answering the question did. */
export function cellObserver(model) {
  const places = new Map();
  for (const place of Array.isArray(model?.places) ? model.places : []) {
    if (place && typeof place.id === "string") places.set(place.id, new Set(place.affordances ?? []));
  }
  const states = new Set(Array.isArray(model?.states) ? model.states : []);
  const cells = model?.cells !== null && typeof model?.cells === "object" ? model.cells : {};
  return (ref) => {
    if (ref?.kind !== "cell") return null;
    if (places.size === 0) return null;
    if (!places.has(ref.place) || !states.has(ref.state)) return false;
    if (!ref.affordance) return true;
    const cell = Array.isArray(cells[`${ref.place}${SEPARATOR}${ref.state}`]) ? cells[`${ref.place}${SEPARATOR}${ref.state}`] : [];
    return cell.includes(ref.affordance);
  };
}

/** An artifact premise holds while the file still has that line. An unreadable
 * file is `false` — a line that cannot be read back cannot be cited. A caller
 * that cannot read the artifact at all should not call this. */
export function artifactObserver(read) {
  return (ref) => {
    if (ref?.kind !== "artifact") return null;
    let body;
    try {
      body = read(ref.path);
    } catch {
      return false;
    }
    if (typeof body !== "string" || body === "") return false;
    const lines = body.split(/\r?\n/).length - (body.endsWith("\n") ? 1 : 0);
    return ref.line <= lines;
  };
}

/**
 * The observation for a card's state dir: its contrast matrix, and any artifact
 * a premise cites, read relative to that directory.
 *
 * Both halves are advisory. A missing or unparseable matrix yields no verdict
 * for cell refs, and an unreadable artifact yields a verdict only for the ref
 * that cites it — so a card mid-rewrite never has its decisions called stale by
 * an error, only by an observation that succeeded and found nothing.
 */
export function observeFromCard({ stateDir, readText } = {}) {
  const read = typeof readText === "function"
    ? readText
    : (path) => readFileSync(join(stateDir ?? "", path), "utf8");
  let model = null;
  if (typeof stateDir === "string" && stateDir) {
    try {
      model = parseContrastArtifact(readFileSync(join(stateDir, CONTRAST_ARTIFACT), "utf8"));
    } catch {
      model = null;
    }
  }
  const cell = cellObserver(model);
  const artifact = artifactObserver(read);
  return (ref) => (ref?.kind === "cell" ? cell(ref) : artifact(ref));
}
