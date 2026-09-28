import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { DisclosureSection } from "../disclosure";
import type { rpcContract } from "../../server";
import { Button } from "@/components/ui/button";

type QualitySeal = { status: string; failures: string[]; label: string | null };

export function ExploreQualitySection({ cardId, filePath, repairing, onRepair }: {
  cardId: string;
  filePath: string | null;
  repairing: boolean;
  onRepair: (lines: string[]) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [seal, setSeal] = useState<QualitySeal | null>(null);
  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    void rpc.call("qualitySeal", { cardId, path: filePath }).then((result) => { if (!cancelled) setSeal(result); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [rpc, cardId, filePath]);
  if (!filePath) return null;
  const failures = seal?.failures ?? [];
  const lines = failures.map((failure) => `${seal?.label ?? filePath}: ${failure} — rewrite it, then run verify again.`);
  return (
    // The shared surface, and open only when something is actually wrong. A
    // clean seal is the absence of news: it used to render as its own always-open
    // `border p-4` panel saying so, which spent a box on "nothing to report" and
    // made the report that DOES matter indistinguishable from it.
    <DisclosureSection
      title="Artifact quality"
      subtitle={!seal
        ? "checking the stage deliverable"
        : failures.length === 0
          ? "meets its contract"
          : `${failures.length} failure${failures.length === 1 ? "" : "s"}`}
      defaultOpen={failures.length > 0}
    >
      {!seal ? <p className="text-xs text-muted-foreground">Checking…</p> : null}
      {seal && failures.length === 0 ? <p className="text-xs text-muted-foreground">Stage deliverable meets its contract.</p> : null}
      {seal && failures.length > 0 ? (
        <div className="space-y-2">
          <ul className="space-y-1">
            {failures.map((failure, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-500" />
                <span>{failure}</span>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="outline" disabled={repairing} onClick={() => onRepair(lines)} title="Post the failure list as a comment and resume the worker to fix it.">{repairing ? "Repairing…" : "Repair this artifact"}</Button>
        </div>
      ) : null}
    </DisclosureSection>
  );
}
