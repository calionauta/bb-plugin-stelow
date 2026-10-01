import { Button } from "@/components/ui/button";
import { DisclosureSection } from "../disclosure";

type SubstepQuality = { slug: string; status: "ready" | "missing" | "invalid" | "needs-depth" };
type ResearchRound = { n: number; label: string; status: "ready" | "pending" | "missing"; substeps: SubstepQuality[] };

// A research substep's quality, which is its OWN axis and shares no value with a
// card's status or a pendency's — checked value by value, not assumed. That is
// why it has a local map rather than borrowing one: `ready` is not a status
// anywhere else, and folding it into a shared vocabulary would make a reader
// wonder which machine they were looking at.
//
// The two entries that used to label themselves (`ready: "ready"`,
// `missing: "missing"`) were the only labels in the plugin that equalled their
// stored value, which is the shape the stage rule forbids everywhere else: a
// reader cannot tell whether they are looking at a word or at a variable. The
// other two were already phrases — "thin or mirrored" says what `invalid` means,
// and "needs depth" says what `needs-depth` asks for.
const STATUS_LABEL: Record<SubstepQuality["status"], string> = {
  ready: "Ready",
  missing: "Missing",
  invalid: "thin or mirrored",
  "needs-depth": "needs depth",
};

const STATUS_DOT: Record<SubstepQuality["status"], string> = {
  ready: "bg-emerald-500",
  missing: "bg-zinc-400",
  invalid: "bg-orange-500",
  "needs-depth": "bg-amber-500",
};

function allClearCopy(roundCount: number): string {
  const rounds = roundCount === 1 ? "1 round" : `${roundCount} rounds`;
  return `All composite substeps meet their contracts. ${rounds} checked.`;
}

export function ResearchQualitySection({ rounds, repairing, onRepair }: {
  rounds: ResearchRound[];
  repairing: boolean;
  onRepair: (lines: string[]) => void;
}) {
  const composite = rounds.filter((round) => round.substeps.length > 0);
  if (composite.length === 0) return null;
  const open = composite.flatMap((round) => round.substeps.filter((sub) => sub.status !== "ready").map((sub) => ({ round, sub })));
  const lines = open.map(({ round, sub }) => `Round ${round.n} (${round.label} — ${sub.slug}): ${STATUS_LABEL[sub.status]} — rewrite per the playbook completeness contract, then run verify again.`);
  return (
    // The shared surface, and open only when something is actually wrong. A
    // clean quality report is the absence of news: it used to render as its own
    // always-open `border p-4` panel saying so, which spent a box on "nothing to
    // report" and made the report that DOES matter indistinguishable from it.
    <DisclosureSection
      title="Artifact quality"
      subtitle={open.length === 0
        ? "every substep meets its contract"
        : `${open.length} substep${open.length === 1 ? "" : "s"} not ready`}
      defaultOpen={open.length > 0}
    >
      {open.length === 0
        ? <p className="text-xs text-muted-foreground">{allClearCopy(rounds.length)}</p>
        : (
        <div className="space-y-2">
          <ul className="space-y-1">
            {open.map(({ round, sub }) => <li key={`${round.n}-${sub.slug}`} className="flex items-start gap-2 text-xs"><span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${STATUS_DOT[sub.status]}`} /><span>Round {round.n} ({sub.slug}): {STATUS_LABEL[sub.status]}</span></li>)}
          </ul>
          <Button size="sm" variant="outline" disabled={repairing} onClick={() => onRepair(lines)} title="Post the failure list as a comment and resume the worker to fix it.">{repairing ? "Repairing…" : "Repair this artifact"}</Button>
        </div>
      )}
    </DisclosureSection>
  );
}
