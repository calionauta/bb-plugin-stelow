/**
 * The card's answer to "what is this, and where does it stand?" — one glance,
 * above the fold, before any section a reader has to expand.
 *
 * The card already carried every fact below, but distributed: the stage in the
 * hero, run outcomes in a list, artifact counts in a collapsed section, the
 * checks inside a disclosure. So the person opening a card had to visit four
 * places and remember four numbers to answer two questions — what did this
 * produce, and is anything still blocking it. That is the work a summary is
 * for, and its absence is why the card read as twelve unrelated sections.
 *
 * Two rules, both about honesty rather than brevity:
 *
 * - A number is stated only when the data that produced it is present. An
 *   artifact count needs the artifacts; a scope count needs the scopes. A card
 *   mid-flight has neither yet, and "0 files" would be a claim, not a fact.
 * - Whatever still needs a person outranks everything else. A card waiting on
 *   a decision is a different card from one that quietly finished, and the
 *   summary leads with whichever it is.
 */

/** The thing a person must do next, if there is one. */
export function cardBlocker({ heroKind, pendingQuestions, expiredQuestions, activity }) {
  const pending = (pendingQuestions ?? 0) + (expiredQuestions ?? 0);
  if (heroKind === "decision" || pending > 0) {
    return {
      kind: "decision",
      text: pending === 1
        ? "1 question waiting on you"
        : `${pending} questions waiting on you`,
    };
  }
  if (activity === "error" || heroKind === "error") {
    return { kind: "error", text: "The worker stopped" };
  }
  if (heroKind === "paused") {
    return { kind: "paused", text: "Paused" };
  }
  return null;
}

/**
 * The run tally, or null when there are no runs to tally. An empty list is not
 * "0 runs" — a card that never dispatched a run has a different story from one
 * whose runs were all cleaned up, and neither is worth a row.
 */
export function runTally(runs) {
  if (!Array.isArray(runs) || runs.length === 0) return null;
  const count = (state) => runs.filter((run) => run?.normalizedStatus === state).length;
  const failed = count("failed");
  const succeeded = count("succeeded");
  const cancelled = count("cancelled");
  const waiting = count("needs_input");
  const running = count("running") + count("queued");
  // Failures first, then the live states, then the tally of what worked: a
  // reader scanning this wants the problem before the progress.
  const parts = [];
  if (failed > 0) parts.push({ tone: "destructive", text: `${failed} failed` });
  if (waiting > 0) parts.push({ tone: "warning", text: `${waiting} waiting` });
  if (running > 0) parts.push({ tone: "default", text: `${running} running` });
  if (succeeded > 0) parts.push({ tone: "success", text: `${succeeded} succeeded` });
  if (cancelled > 0) parts.push({ tone: "muted", text: `${cancelled} cancelled` });
  return parts.length > 0 ? parts : null;
}

/** The deliverable count. Evidence is not a deliverable and is not counted. */
export function deliverableCount(artifacts) {
  if (!Array.isArray(artifacts)) return null;
  const count = artifacts.filter((artifact) => artifact?.role !== "evidence").length;
  return count > 0 ? count : null;
}

/** The scope tally, or null when nothing was ever scoped. */
export function scopeTally(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) return null;
  const done = scopes.filter((scope) => scope?.status === "done").length;
  return done > 0 ? `${done}/${scopes.length} scopes done` : `${scopes.length} scopes`;
}

/**
 * The whole summary, assembled. Returns null when it would say nothing worth
 * saying — a card with no runs, no artifacts, no scopes, and no blocker is
 * better described by the sections below it than by an empty strip.
 */
export function cardSummary({ heroKind, activity, status, stage, runs, artifacts, scopes, pendingQuestions, expiredQuestions, stageLabel }) {
  const blocker = cardBlocker({ heroKind, pendingQuestions, expiredQuestions, activity });
  const run = runTally(runs);
  const files = deliverableCount(artifacts);
  const scoped = scopeTally(scopes);
  if (!blocker && !run && files === null && scoped === null) return null;
  return {
    blocker,
    stage: stage ? stageLabel(stage) : null,
    terminal: status === "completed" || status === "archived",
    run,
    files,
    scoped,
  };
}
