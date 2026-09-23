import { Button } from "@/components/ui/button";

type SubstepQuality = { slug: string; status: "ready" | "missing" | "invalid" | "needs-depth" };
type ResearchRound = { n: number; label: string; status: "ready" | "pending" | "missing"; substeps: SubstepQuality[] };

const STATUS_LABEL: Record<SubstepQuality["status"], string> = {
  ready: "ready",
  missing: "missing",
  invalid: "thin or mirrored",
  "needs-depth": "needs depth",
};

const STATUS_DOT: Record<SubstepQuality["status"], string> = {
  ready: "bg-emerald-500",
  missing: "bg-zinc-400",
  invalid: "bg-orange-500",
  "needs-depth": "bg-amber-500",
};

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
    <section aria-label="Artifact quality" className="rounded-lg border p-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Quality</h3>
      {open.length === 0 ? <p className="pt-1 text-xs text-muted-foreground">All composite substeps meet their contracts. {rounds.length === 1 ? "1 round" : `${rounds.length} rounds`} checked.</p> : (
        <div className="space-y-2 pt-2">
          <ul className="space-y-1">
            {open.map(({ round, sub }) => <li key={`${round.n}-${sub.slug}`} className="flex items-start gap-2 text-xs"><span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${STATUS_DOT[sub.status]}`} /><span>Round {round.n} ({sub.slug}): {STATUS_LABEL[sub.status]}</span></li>)}
          </ul>
          <Button size="sm" variant="outline" disabled={repairing} onClick={() => onRepair(lines)} title="Post the failure list as a comment and resume the worker to fix it.">{repairing ? "Repairing…" : "Repair this artifact"}</Button>
        </div>
      )}
    </section>
  );
}
