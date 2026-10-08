import { scopeXrayPresentation } from "../../lib/scope-xray-presentation.mjs";
import { Pill } from "../dashboard/build-status-pills";
import { SUMMARY_BASE } from "../disclosure";
import { TEXT_META, TEXT_SECTION } from "../../lib/design-tokens";

export type ScopeXrayView = {
  source: "server-projection";
  mutable: false;
  draft?: boolean;
  mapId: string;
  mapVersion: string;
  freshness: "current" | "stale" | "unknown";
  decisions?: {
    live: number;
    stale: number;
    unknown: number;
    conflicts: Array<{ a: string; b: string; scopeIds: string[] }>;
  } | null;
  nodes: Array<{
    id: string;
    title: string;
    capabilities: string[];
    state: "current" | "stale" | "blocked" | "unknown";
    provenance: string[];
  }>;
  edges: Array<{
    from: string;
    to: string;
    kind: "depends-on";
    state: "current" | "stale" | "blocked" | "unknown";
    provenance: string[];
  }>;
};

const WARN = "bg-amber-500/15 text-amber-700 dark:text-amber-300";
const QUIET = "bg-muted text-muted-foreground";

/**
 * The approved scope map, as a reader can check it.
 *
 * It was a bordered box of its own on a card made of bordered boxes, at 11px,
 * with the map's freshness printed in the header AND on every one of its seven
 * nodes, and the raw contract words `current` / `stale` / `unknown` shown to
 * anyone. `current` there means "this entry still matches the card's shape
 * version" — a staleness fact — and printed next to a scope id it read as
 * "this is the scope being worked on", which is the opposite of what it means
 * and the second half of a contradiction with the tracker below.
 *
 * So the freshness is said once, in the header, as a sentence a reader can act
 * on. A node says something only when it DEVIATES from the map's baseline,
 * because seven identical "in sync" lines are the header's job done seven more
 * times. The dependency graph — ten arrows on one line, none of which a reader
 * scans — sits behind a disclosure instead of above the fold.
 */
export function ScopeXray({ xray }: { xray: ScopeXrayView }) {
  const view = scopeXrayPresentation(xray);
  if (!view) return null;
  const draft = xray.draft === true;
  return (
    <section className="space-y-2" aria-label={draft ? "Scope draft preview" : "Scope map"}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className={TEXT_SECTION}>{draft ? "Scope draft" : "Scope map"}</h3>
        {draft ? (
          <Pill tone={QUIET}>Draft preview</Pill>
        ) : (
          <Pill tone={view.freshness.tone === "warn" ? WARN : QUIET}>{view.freshness.label}</Pill>
        )}
        <span className={TEXT_META}>
          {view.scopeCount} scope{view.scopeCount === 1 ? "" : "s"} · {draft ? "not approved" : "approved"}
        </span>
      </div>
      <p className={TEXT_META}>
        {draft
          ? "Preview for the gate review — the scope stage still has to approve it. Nobody edits this here."
          : view.freshness.note}
      </p>
      {draft || !view.decisions ? null : (
        <p className={TEXT_META}>Decisions: {view.decisions}</p>
      )}
      <ul className="space-y-1.5">
        {view.nodes.map((node) => (
          <li key={node.id} className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-xs text-muted-foreground">{node.id}</span>
              <span className="text-sm text-foreground">{node.title}</span>
              {node.state ? (
                <Pill tone={node.state.tone === "warn" ? WARN : QUIET}>{node.state.label}</Pill>
              ) : null}
            </div>
            {node.capabilities.length > 0 ? (
              <p className={`${TEXT_META} break-words`}>
                Covers: {node.capabilities.join(", ")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {view.dependencies.length > 0 ? <ScopeDependencies view={view} /> : null}
    </section>
  );
}

/**
 * The dependency edges, folded away.
 *
 * Ten arrows on one line of 11px text is the densest thing on the card and the
 * only part almost no reader is looking for — it was rendered inline, above
 * everything, whether or not anyone cared. It stays on the page (the map is
 * incomplete without it) but stops competing with the scopes themselves.
 */
function ScopeDependencies({ view }: { view: NonNullable<ReturnType<typeof scopeXrayPresentation>> }) {
  return (
    <details className="text-xs">
      <summary className={SUMMARY_BASE}>
        {view.dependencies.length} dependenc{view.dependencies.length === 1 ? "y" : "ies"} between scopes
      </summary>
      <ul className="mt-1 space-y-0.5 pl-1">
        {view.dependencies.map((edge) => (
          <li key={`${edge.from}->${edge.to}`} className={TEXT_META}>
            <span className="font-mono">{edge.from}</span>
            <span aria-hidden> → </span>
            <span className="font-mono">{edge.to}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
