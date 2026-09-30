import { useCallback, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "../../server";
import { sharedCheckoutVerdict } from "../../lib/shared-checkout-exposure.mjs";
import { DisclosureSection } from "../disclosure";

// Who else is in this card's files, asked on purpose rather than reported after
// a collision.
//
// Two sources, and the second one is why this section cannot be closed on the
// data it already has. The occupancy lines are the CARD half, derived
// server-side from the claim ledger the lock protocol already enforces, so they
// render and decide nothing: they show the state BEFORE a collision, which is
// the one thing the lock wall cannot say.
//
// The THREAD half is the part a claim can never hold. A thread outside the
// plugin never acquires a claim, so on a card whose preset falls back to
// `project-default` — the shared project checkout, and the default for every
// host with no New-worktree preset — the ledger says "nobody" while another
// agent edits the same file. Hiding the section when the ledger is empty would
// hide exactly that case, which is the one worth seeing. So the section is
// present whenever the card is not isolated, and the cross-thread check is a
// control the reader presses: the answer costs a subprocess on the host, and
// the reader is the one who decides to spend it.
//
// Closed by default, like every section that is not `live` or `blocking`. An
// empty answer renders nothing at all rather than an empty box — and under a
// managed worktree the server says `isolated`, because isolation is the reason
// there is nothing to report, and hiding that reason would read as a scan that
// found nobody.
export type FileOccupancyView = {
  isolated: boolean;
  lines: string[];
  shared: number;
};

// Derived from the RPC, not restated. A hand-written copy of the report type
// is a second place to forget a reason, and a reason missing here typechecked
// fine and rendered as somebody else's answer.
type Exposure = z.infer<typeof rpcContract.sharedCheckoutExposure.output>;

const NO_OTHERS = "No other card holds these files.";

export function FileOccupancy({ occupancy, cardId }: {
  occupancy: FileOccupancyView;
  cardId: string;
}) {
  const { report, checking, check } = useCrossThreadCheck(cardId);
  if (occupancy.isolated) return null;

  const others = report?.lines ?? [];
  const lines = [...occupancy.lines, ...others];
  const hint = occupancy.shared > 0
    ? `${occupancy.shared} ${occupancy.shared === 1 ? "file" : "files"} another card also holds`
    : undefined;

  return (
    <DisclosureSection
      title="Shared files"
      subtitle="who else is in the files this card holds"
      hint={hint}
      action={
        report ? null : (
          <button
            onClick={check}
            disabled={checking}
            className={
              "cursor-pointer rounded px-2 py-1 text-xs font-medium text-primary hover:underline "
              + "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default"
            }
          >
            {checking ? "Checking…" : "Check for other agents"}
          </button>
        )
      }
    >
      {lines.length === 0 ? <p className="text-xs text-muted-foreground">{NO_OTHERS}</p> : null}
      <ul className="space-y-1">
        {lines.map((line) => (
          <li key={line} className="text-xs text-muted-foreground">{line}</li>
        ))}
      </ul>
      {report ? <CheckedVerdict report={report} /> : null}
    </DisclosureSection>
  );
}

// What the check found, in the reader's terms. A check that ran and found
// nothing says so; silence would be indistinguishable from a check that never
// happened, which is the ambiguity this section exists to remove.
//
// The sentence comes from lib/, next to the reasons it maps, because the two
// must not drift: the local copy of this used to give every reason it did not
// recognise — including a card with no readable checkout, and both of the
// answers that mean "this was not measured" — the same clean bill of health.
function CheckedVerdict({ report }: { report: Exposure }) {
  if (report.lines.length > 0) return null;
  const text = sharedCheckoutVerdict(report);
  return text ? <p className="text-xs text-muted-foreground">{text}</p> : null;
}

// One call per reader, never on the open-card path. The server caches the
// thread list for 30s and short-circuits a managed worktree before any
// subprocess, so this is cheap even when it is not needed — and it is not
// called at all until asked.
function useCrossThreadCheck(cardId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [report, setReport] = useState<Exposure | null>(null);
  const [checking, setChecking] = useState(false);
  const check = useCallback(async () => {
    setChecking(true);
    try {
      setReport(await rpc.call("sharedCheckoutExposure", { cardId }));
    } catch {
      setReport({ isolated: false, threads: 0, files: [], lines: [], reason: "unavailable" });
    } finally {
      setChecking(false);
    }
  }, [rpc, cardId]);
  return { report, checking, check };
}
