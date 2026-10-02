/**
 * The words a scope's dependencies need, and the states they can be in.
 *
 * The dependency rows used to be a wrapping line of pills reading `after <name>`
 * and `blocked by <name>`. Three things were wrong with that, and all three
 * are why a reader could not read the shape of a scope's dependencies:
 *
 * 1. A satisfied dependency and an unsatisfied one rendered the IDENTICAL
 *    string. Only the pill's background differed, so the state was carried by
 *    colour alone (WCAG 1.4.1) and vanished in a high-contrast or printed view.
 * 2. `blocked by` was permanently amber. The finished() check was consulted on
 *    the dependsOn branch and not the blockedBy branch, so a dependency that
 *    was long since satisfied still looked like a live block.
 * 3. It was `text-[11px]`, and it sat in the summary — so the one fact that
 *    says what a scope is waiting on was the smallest text on the card.
 *
 * So state is a word, not a colour; the word is derived here so the component
 * cannot disagree with itself; and a missing target stays visible as missing
 * rather than being filtered away. Direction is explicit: this scope waits on
 * that one, not the other way round.
 *
 * The layout is the spike's (context/scope-graph-spike.md): measured depth is 3
 * and max fan-in 4 across every scope map in this repo, so a spatial graph
 * solves a problem this domain does not have. Text rows with state as the only
 * visual variable survive depth 4 or fan-in 6 unchanged.
 */

/** Dependency states, in the order a reader meets them. */
export const DEPENDENCY_STATE = Object.freeze({
  satisfied: { label: "done", tone: "muted", glyph: "✓" },
  running: { label: "running", tone: "active", glyph: "●" },
  waiting: { label: "not started", tone: "muted", glyph: "○" },
  missing: { label: "not on this card", tone: "warn", glyph: "?" },
});

/**
 * One dependency row.
 *
 * @param from the scope that waits
 * @param to the scope it waits on (null when the target is not on the card)
 * @param kind which relation: an ordering edge or an explicit block
 * @param targetStatus the target's status, or null when it is not on the card
 * @returns `{ from, to, kind, state, text }` with state always explicit
 */
export function dependencyRow(input = {}) {
  const { from, to, kind = "depends-on", targetStatus = null } = input && typeof input === "object" ? input : {};
  const relation = kind === "blocked-by" ? "waits on" : "after";
  const name = typeof to === "string" && to ? to : null;
  if (!name) {
    return {
      from: from ?? null,
      to: null,
      kind,
      state: "missing",
      text: `${relation} a scope that is not on this card`,
    };
  }
  const state = stateForStatus(targetStatus);
  const stateInfo = DEPENDENCY_STATE[state];
  // The state is a word, not only a colour: a satisfied dependency and a
  // waiting one read differently with no styling at all.
  return {
    from: from ?? null,
    to: name,
    kind,
    state,
    text: `${relation} ${name} — ${stateInfo.label}`,
    label: stateInfo.label,
    tone: stateInfo.tone,
    glyph: stateInfo.glyph,
  };
}

/**
 * A scope's dependencies as rows, ordering first, then blocks, then missing.
 *
 * Order follows the declaration order the caller already has (which is the
 * card's dependency order), so this never re-sorts a list the scope-order
 * module decided.
 */
export function dependencyRows(input = {}) {
  const {
    from,
    dependsOn,
    blockedBy,
    scopeById = new Map(),
  } = input && typeof input === "object" ? input : {};
  // A caller whose scope has no dependency fields passes null/undefined; that
  // is "no dependencies", not a crash. The old component filtered with
  // `?.` for exactly this reason, and dropping the guard here would move the
  // crash rather than remove it.
  const order = Array.isArray(dependsOn) ? dependsOn : [];
  const blocks = Array.isArray(blockedBy) ? blockedBy : [];
  const byId = scopeById instanceof Map ? scopeById : new Map();
  const row = (id, kind) => {
    const target = byId.get(id);
    // A target that is not on the card is missing, whatever its id says.
    if (!target) return missingRow(from, id, kind);
    const name = typeof target.name === "string" && target.name ? target.name : id;
    return dependencyRow({
      from,
      to: name,
      kind,
      targetStatus: typeof target.status === "string" ? target.status : null,
    });
  };
  return [
    ...order.map((id) => row(id, "depends-on")),
    ...blocks.map((id) => row(id, "blocked-by")),
  ];
}

/**
 * A row for a target that is not on this card.
 *
 * Shown rather than filtered: a broken edge is a fact about the map, and
 * hiding it makes a card with a dangling dependency look clean.
 */
function missingRow(from, id, kind) {
  const info = DEPENDENCY_STATE.missing;
  return {
    from: from ?? null,
    to: id,
    kind,
    state: "missing",
    text: `${relationFor(kind)} ${id} — ${info.label}`,
    label: info.label,
    tone: info.tone,
    glyph: info.glyph,
  };
}

function relationFor(kind) {
  return kind === "blocked-by" ? "waits on" : "after";
}

/** Rows that name a target this card does not have. */
export function missingDependencyRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row?.state === "missing");
}

/**
 * Which state a target is in.
 *
 * `missing` is decided by whether the target EXISTS, never by its status: a
 * target that is on the card but whose status this card has not been told is
 * still a real scope, and calling it missing would send a reader hunting a
 * broken edge that does not exist. Absent and not-yet-told are different
 * faults, so they get different words.
 */
function stateForStatus(status) {
  if (["done", "completed", "archived"].includes(status)) return "satisfied";
  if (["in-progress", "running"].includes(status)) return "running";
  return "waiting";
}
