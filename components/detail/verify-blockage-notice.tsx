import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "../../server";
import { Button } from "@/components/ui/button";

// Derived from the RPC, not restated: the states live in
// lib/verify-blockage.mjs, and a hand-written copy here would let the two
// drift until a state renders nothing.
type Blockage = z.infer<typeof rpcContract.verifyBlockage.output>;

function shortSha(sha: string | null) {
  return sha ? sha.slice(0, 7) : "unknown";
}

// Whether the verify failure parking this decision hero is still the failure
// to act on. Fetched on mount, never on the open-card path: the answer costs
// a subprocess on the host, and only a card parked on open questions can use
// it. `clear` and `unknown` render nothing — a notice that the block is fine
// is noise, and an unmeasured block is not a measured absence of one.
export function VerifyBlockageNotice({ cardId, onResume, retrying }: {
  cardId: string;
  onResume: () => Promise<void>;
  retrying: boolean;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [report, setReport] = useState<Blockage | null>(null);
  useEffect(() => {
    let live = true;
    rpc.call("verifyBlockage", { cardId })
      .then((result) => { if (live) setReport(result); })
      .catch(() => { if (live) setReport(null); });
    return () => { live = false; };
  }, [rpc, cardId]);
  if (!report || report.state === "clear" || report.state === "unknown") return null;
  if (report.state === "confirmed") {
    return (
      <p className="w-full text-xs text-muted-foreground">
        Verify failed on this exact checkout ({shortSha(report.runHeadSha)}). Re-running changes nothing — fix
        the code or the pin first.
      </p>
    );
  }
  return (
    <div className="w-full space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2" role="note">
      <p className="text-xs leading-relaxed text-amber-900 dark:text-amber-200">
        The checkout moved since verify {report.exitCode === 0 ? "passed" : "failed"} ({shortSha(report.runHeadSha)} →{" "}
        {shortSha(report.currentHeadSha)}). The failure may be stale — resuming re-runs verify on the current tree.
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={retrying}
        onClick={() => void onResume()}
        title="Resume the worker to re-run verify on the current checkout — nothing is reset."
      >
        {retrying ? "Resuming…" : "Resume worker to re-verify"}
      </Button>
    </div>
  );
}
