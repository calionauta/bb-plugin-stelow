/**
 * The same condition, said once.
 *
 * `evidenceConditions()` in `lib/trackable-evidence.mjs` derives every message
 * from `displayName(entry)`, so two scopes carrying the same condition type
 * produce structurally identical text that differs only in the scope's name.
 * Rendered per scope, a seven-scope card printed seven copies of each line —
 * twenty-one lines of `text-[11px]` amber, of which the reader could act on at
 * most one idea: *none of these scopes closed cleanly, and that is a problem
 * with the card, not with any single scope*.
 *
 * The first attempt at fixing this was to notice the lines are identical and
 * hoist them to card level. That proof does not hold: the scope name is inside
 * the string, and naming the scope is the message's job — a condition that
 * applies to seven scopes must still say which seven. What repeats is the
 * CONDITION, not the sentence.
 *
 * So this groups by condition type and keeps the names. One row per type, naming
 * every scope it applies to, with the first scope's message as the wording
 * (they are identical by construction once the name is accounted for) and the
 * rest recoverable. A condition that applies to exactly one scope keeps that
 * scope's own message verbatim, because a single-scope condition reads better
 * as a sentence about that scope than as a list of one.
 */

/** A scope as this module needs it: an id, a name, and its conditions. */
function entryId(entry) {
  if (entry && typeof entry === "object") {
    if (typeof entry.id === "string" && entry.id) return entry.id;
  }
  return null;
}

function entryName(entry) {
  if (entry && typeof entry === "object") {
    if (typeof entry.name === "string" && entry.name) return entry.name;
  }
  return entryId(entry) ?? "a scope";
}

/**
 * Group conditions across scopes by their `type`.
 *
 * Order follows first appearance, so the card reads in the order the conditions
 * were observed rather than alphabetically. Scopes within a group keep their
 * given order too, which is the caller's dependency order — the card already
 * decided what order a reader meets its scopes in, and this must not re-sort
 * them.
 *
 * @param entries scopes carrying `conditions` arrays
 * @returns one row per condition type: `{ type, reason, message, scopes, scopeIds }`
 */
export function groupConditionsByType(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const groups = new Map();
  for (const entry of list) {
    const conditions = entry && typeof entry === "object" && Array.isArray(entry.conditions) ? entry.conditions : [];
    const seenHere = new Set();
    for (const condition of conditions) {
      if (!condition || typeof condition !== "object") continue;
      const type = typeof condition.type === "string" ? condition.type : null;
      if (!type) continue;
      // A scope carrying the same type twice (blockedBy and dependsOn, say)
      // is one scope with that condition, not two.
      if (seenHere.has(type)) continue;
      seenHere.add(type);
      let group = groups.get(type);
      if (!group) {
        group = { type, reason: condition.reason ?? type, message: condition.message ?? type, scopes: [], scopeIds: [] };
        groups.set(type, group);
      }
      group.scopes.push(entryName(entry));
      const id = entryId(entry);
      if (id) group.scopeIds.push(id);
    }
  }
  return [...groups.values()];
}

/**
 * How many times a condition type repeats across scopes.
 *
 * The count is what tells a reader whether the condition is a fact about one
 * scope or about the whole card, and it is the number the old per-scope
 * rendering made impossible to see. 1 means the row is about that scope alone.
 */
export function conditionSpread(group) {
  if (!group || typeof group !== "object" || !Array.isArray(group.scopeIds)) return 0;
  return group.scopeIds.length;
}

/** True when one condition type applies to more than one scope. */
export function isSharedCondition(group) {
  return conditionSpread(group) > 1;
}
