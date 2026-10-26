/**
 * The stage trail a bundle is missing.
 *
 * `state.md` records every stage it LEFT (`history: - stage: x / at: t / status:
 * done`) and which stage it is on now. That is a trail: each entry closes a stage
 * at `at`, and the next entry (or `current_stage`) opened at that same instant. The
 * run bundle copied the artifacts and dropped the trail, so no bundle could be
 * replayed against the route its intent declares — a reader could see what the card
 * produced and not where it had been.
 *
 * Pure on purpose: the same state file yields the same trail on any host, which is
 * what makes it checkable after the thread is gone.
 */

/** Parse `history:` + `current_stage` into `[{ stage, enteredAt, leftAt }]`. */
export function parseStageTrail(stateBlob) {
  const text = String(stateBlob ?? "");
  const current = text.match(/^current_stage:\s*(\S+)\s*$/m)?.[1] ?? null;
  const history = text.split("\nhistory:")[1] ?? "";
  const closed = [...history.matchAll(/^\s*- stage:\s*(\S+)\s*$/gm)].map((entry) => entry[1]);
  const stamps = [...history.matchAll(/^\s+at:\s*(\S+)\s*$/gm)].map((entry) => entry[1]);

  const stages = closed.slice();
  if (current && stages.at(-1) !== current) stages.push(current);

  return stages.map((stage, index) => ({
    stage,
    // A stage opens when the previous one closed (the state file writes both in
    // the same advance), and the first one has no recorded entry.
    enteredAt: index === 0 ? null : stamps[index - 1] ?? null,
    leftAt: index < closed.length ? stamps[index] ?? null : null,
  }));
}

/** The `## Stage trail` section, or empty when the state has no history yet. */
export function renderStageTrail(trail) {
  const rows = Array.isArray(trail) ? trail : [];
  if (rows.length === 0) return [];
  const cell = (value) => (value ? String(value) : "—");
  return [
    "## Stage trail",
    "",
    "| Stage | Entered | Left |",
    "|-------|---------|------|",
    ...rows.map((row) => `| ${row.stage} | ${cell(row.enteredAt)} | ${cell(row.leftAt)} |`),
    "",
  ];
}
