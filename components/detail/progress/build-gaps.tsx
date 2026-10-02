import { isDoneStatus, trackableStatusLabel as statusLabel } from "../../../lib/trackables.mjs";
import { statusGlyph, statusTone } from "../../../lib/detail-presentation.mjs";
import { gapSummaryPresentation } from "../../../lib/build-progress-presentation.mjs";
import { DisclosureSection } from "../../disclosure";
import { Pill } from "../../dashboard/build-status-pills";

export type GapSummary = {
  matched: boolean; total: number; fixed: number; documented: number; escalated: number;
  items: Array<{ description: string; resolution: string; scopeStatus: string | null }>;
  pendingScopes: number; unscoped: number; leadMs: number | null; cycleMs: number | null; done: boolean;
};

/**
 * How a gap reads once the critique is over. A disposition the registry
 * recorded is a fact about the finding, so it is the primary mark; the rework
 * scope only exists for an escalation, and is what a reader is waiting on when
 * one is still open.
 *
 * `unknown` is a real state, not a defensive branch: the registry validator
 * flags a row with a missing or unrecognised `resolution:` as a failure, but a
 * failure is a REPORT and does not stop the card from rendering it. Indexing a
 * record that lacks the key used to throw and take the whole open card down over
 * a typo in one row of a YAML file.
 */
const GAP_RESOLUTION: Record<string, { label: string; dot: string; pill: string }> = {
  fixed: { label: "Fixed", dot: "bg-emerald-500", pill: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  documented: { label: "Documented", dot: "bg-muted-foreground/60", pill: "bg-muted text-muted-foreground" },
  escalate: { label: "Escalated", dot: "bg-amber-500", pill: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  unknown: { label: "Unclassified", dot: "bg-amber-500/60", pill: "bg-muted text-muted-foreground" },
};

function GapItems({ items }: { items: GapSummary["items"] }) {
  return (
    <ul className="space-y-1 pt-2">
      {items.map((item) => {
        const resolution = GAP_RESOLUTION[item.resolution] ?? GAP_RESOLUTION.unknown;
        const scopeDone = item.scopeStatus !== null && isDoneStatus(item.scopeStatus);
        return (
          <li key={item.description} className="flex items-start gap-2 text-xs">
            <span
              aria-hidden
              className={`mt-1.5 size-2 shrink-0 rounded-full ${scopeDone ? "bg-emerald-500" : resolution.dot}`}
            />
            <span className="flex-1">{item.description}</span>
            {item.scopeStatus ? (
              <Pill tone={statusTone(item.scopeStatus)}>
                <span className="mr-1">{statusGlyph(item.scopeStatus)}</span>
                {statusLabel(item.scopeStatus)}
              </Pill>
            ) : (
              <Pill tone={resolution.pill}>{resolution.label}</Pill>
            )}
            {item.resolution === "escalate" && !item.scopeStatus ? (
              <span className="text-amber-700 dark:text-amber-300">no scope yet</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Gaps and rework: a section like any other, not a free-standing panel.
 *
 * It was `rounded-lg border p-4` with its own uppercase heading — a different
 * box on a card of identical boxes, on a card whose visual hierarchy is
 * precisely "one hero, then sections of one shape". The list of gap items is
 * history — gaps a past run recorded — so it starts closed and its tally lives
 * in the header, which is the same contract every other section on the card
 * already follows.
 *
 * The list carries every gap the registry named, not only the escalated ones.
 * Gating it on `escalated > 0` made a critique of two documented gaps render a
 * header reading "2 gaps" above an empty section: the tally counted findings,
 * the body listed rework, and a reader could not reconcile them.
 */
export function BuildGaps({ summary }: { summary: GapSummary | null }) {
  const view = gapSummaryPresentation(summary);
  if (!summary?.matched || !view) return null;
  const lead = formatGapMs(summary.leadMs);
  const cycle = formatGapMs(summary.cycleMs);
  const tally = [
    `${summary.total} gap${summary.total === 1 ? "" : "s"}`,
    `${summary.fixed} fixed`,
    `${summary.escalated} escalated`,
    lead ? `lead ${lead}` : null,
    cycle ? `cycle ${cycle}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <DisclosureSection
      title="Gaps and rework"
      subtitle="what the critique found"
      hint={tally}
      defaultOpen={summary.escalated > 0}
    >
      {summary.items.length > 0 ? <GapItems items={summary.items} /> : null}
      {view.waitCopy ? <p className="text-xs text-amber-700 dark:text-amber-300">{view.waitCopy}</p> : null}
      {view.resolvedCopy ? <p className="text-xs text-muted-foreground">{view.resolvedCopy}</p> : null}
    </DisclosureSection>
  );
}

function formatGapMs(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return hours % 24 === 0 ? `${hours / 24}d` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `${Math.floor(hours / 24)}d`;
}
