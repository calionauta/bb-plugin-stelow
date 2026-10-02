import { conditionSpread, groupConditionsByType, isSharedCondition } from "../../lib/scope-conditions-grouping.mjs";
import { dependencyRows } from "../../lib/scope-dependency-relations.mjs";
import { TEXT_META } from "../../lib/design-tokens";
import type { ScopeListScope } from "./scopes-list";

/**
 * The two facts a scope list shows ABOUT the set of scopes rather than inside
 * one scope: the conditions several scopes share, and one scope's dependencies.
 *
 * Extracted from `scopes-list.tsx`, which crossed the 400-line file budget when
 * this region grew. Neither belongs to a single scope — one is a property of
 * the whole set, the other is a relation between two of them — so neither was
 * ever the list's own body.
 */

/** Tone follows the state, never replaces it: see the row text. */
const DEP_TONE: Record<"muted" | "active" | "warn", string> = {
  muted: "text-muted-foreground",
  active: "text-foreground",
  warn: "text-amber-700 dark:text-amber-300",
};

/**
 * Condition types that more than one scope carries, decided once per list.
 *
 * A shared type is said once for the card, so repeating it inside each scope
 * would be the fourteen-line wall this replaces. A type only one scope carries
 * stays in that scope, because a single-scope condition reads better as a
 * sentence about that scope. Computed per render and passed down, so two lists
 * on one page cannot share an answer.
 */
export function sharedConditionTypesFor(scopes: ScopeListScope[]): Set<string> {
  return new Set(groupConditionsByType(scopes).filter(isSharedCondition).map((group) => group.type));
}

/**
 * The conditions the card has in common, one row per type, naming the scopes
 * they apply to.
 *
 * The count is the point. Per-scope rendering made "one scope is missing a
 * record" and "every scope is missing a record" look identical, when the first
 * is a task and the second is a problem with how the card was closed.
 */
export function ScopeConditions({ scopes }: { scopes: ScopeListScope[] }) {
  const groups = groupConditionsByType(scopes).filter(isSharedCondition);
  if (groups.length === 0) return null;
  return (
    // No heading, deliberately. This block is a sibling of every scope's
    // <details>, so an <h4> here put a heading in the outline that the next
    // heading down belonged to a per-scope count (WCAG 1.3.1) — a reader
    // walking headings landed on "Shared conditions" and descended into
    // unrelated scope tasks. The aria-label names it for assistive tech
    // without claiming a place in the document outline.
    <section className="space-y-2" aria-label="Scope conditions">
      <p className={TEXT_META}>
        Shared conditions — a fact about how this card closed, not about any single scope.
      </p>
      <ul className="space-y-1.5">
        {groups.map((group) => (
          <li key={group.type} className={`${TEXT_META} text-amber-700 dark:text-amber-300`} role="note">
            <span className="font-medium">{conditionSpread(group)} scopes</span>{" — "}
            {group.message}
            <span className="block text-muted-foreground">
              {group.scopes.length > 6
                ? `${group.scopes.slice(0, 6).join(", ")} and ${group.scopes.length - 6} more`
                : group.scopes.join(", ")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A scope's dependencies, as sentences.
 *
 * These were a wrapping line of pills reading "after <name>", at 11px, where a
 * satisfied dependency and a waiting one rendered the same string — only the
 * pill's background differed, so the shape of the graph was carried by colour
 * alone (WCAG 1.4.1) and vanished wherever colour does not survive. `blocked
 * by` was worse: permanently amber, because the finished check was consulted
 * on one branch and not the other, so a long-satisfied dependency still looked
 * like a live block.
 *
 * Now each row is a sentence naming the target, the direction, and the state
 * as a word. Legibility is the whole point: this is the text that says what a
 * scope is waiting on, and it was the smallest text on the card.
 */
export function ScopeDependencies({ scope, byId }: { scope: ScopeListScope; byId: Map<string, ScopeListScope> }) {
  const rows = dependencyRows({
    from: scope.name,
    dependsOn: scope.dependsOn,
    blockedBy: scope.blockedBy,
    scopeById: byId,
  });
  if (rows.length === 0) return null;
  return (
    <ul className="mt-1.5 space-y-0.5" aria-label="Dependencies">
      {rows.map((row) => (
        <li key={`${row.kind}:${row.to}`} className={`text-xs ${DEP_TONE[row.tone]}`}>
          <span aria-hidden className="mr-1">{row.glyph}</span>
          {row.text}
        </li>
      ))}
    </ul>
  );
}