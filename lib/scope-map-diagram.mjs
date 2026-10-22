/**
 * Scope Map → Mermaid serializer (production view, plugin-side).
 *
 * The Scope Map (`schemas/scope-map.json` upstream) is the only machine
 * contract besides the breadboard: scopes with stable ids and an explicit
 * `dependsOn` DAG. So — like the breadboard — its diagram is DERIVED, never
 * hand-written: the same map always yields byte-identical Mermaid, and a diff
 * in the picture means a diff in the map.
 *
 * This does not duplicate the breadboard serializer upstream: that projection
 * (places, affordances, two flows) is owned by `<stelow-checkout>` and ships
 * as `.mmd`/`.html` files the viewer reads. The Scope Map has no file-based
 * view anywhere, so the plugin derives it on demand at view time instead of
 * writing another artifact that could go stale.
 */

export const SCOPE_DIAGRAM_KIND = "flowchart";

/**
 * Mermaid node ids cannot carry the full scope-id alphabet (the schema allows
 * `.` and `-`, both of which read as syntax). The rewrite keeps labels
 * readable (`S1: Capture`) while node ids stay `[A-Za-z0-9_]`; a collision
 * between two different scope ids is a refusal, not a merged node — merging
 * two scopes into one node would present a hole as a decision.
 */
function nodeId(raw, seen) {
  const base = String(raw).replace(/[^A-Za-z0-9_]/g, "_");
  const id = base || "scope";
  if (seen.has(id) && seen.get(id) !== raw) {
    throw new Error(`scope-map diagram: scope ids collide after sanitizing ("${seen.get(id)}" vs "${raw}")`);
  }
  seen.set(id, raw);
  return id;
}

function label(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/"/g, "&quot;").replace(/[\r\n]+/g, " ");
}

/**
 * The Scope Map DAG as `flowchart TB`: one node per scope, one edge per
 * dependency. Non-current scopes keep their status visible by shape of line:
 * `stale` and `blocked` render dashed, the same way tentative nodes do in the
 * breadboard projection — shape first, colour never the only signal.
 */
export function scopeMapToFlowchart(scopeMap) {
  if (scopeMap === null || typeof scopeMap !== "object" || Array.isArray(scopeMap)) {
    throw new Error("scope-map diagram: expected the parsed scope-map.json object");
  }
  const scopes = scopeMap.scopes;
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error("scope-map diagram: no scopes to draw");
  }
  const byId = new Map();
  for (const scope of scopes) {
    if (!scope || typeof scope.id !== "string" || !scope.id) {
      throw new Error("scope-map diagram: every scope needs a string id");
    }
    byId.set(scope.id, scope);
  }
  const seen = new Map();
  const lines = [`${SCOPE_DIAGRAM_KIND} TB`];
  for (const scope of scopes) {
    const id = nodeId(scope.id, seen);
    lines.push(`  ${id}["${scope.id}: ${label(scope.title ?? scope.id)}"]`);
  }
  for (const scope of scopes) {
    const from = nodeId(scope.id, seen);
    for (const dep of scope.dependsOn ?? []) {
      if (!byId.has(dep)) {
        throw new Error(`scope-map diagram: scope "${scope.id}" depends on unknown scope "${dep}"`);
      }
      lines.push(`  ${nodeId(dep, seen)} --> ${from}`);
    }
  }
  for (const status of ["stale", "blocked"]) {
    const ids = scopes.filter((s) => s.status === status).map((s) => nodeId(s.id, seen));
    if (ids.length > 0) {
      lines.push(`  class ${ids.join(",")} scope${status}`);
      lines.push(`  classDef scope${status} stroke-dasharray:5 5`);
    }
  }
  return lines.join("\n") + "\n";
}
