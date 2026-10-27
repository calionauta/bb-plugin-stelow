import { useCallback, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "../../server";
import { formatActionDuration, formatActionTime, summarizeDetail } from "../../lib/action-replay.mjs";
import { DisclosureSection } from "../disclosure";
import { Button } from "../ui/button";

// What the plugin did on this card, read back from its own recorder.
//
// The card already narrates what the AGENT said (comments) and what the workflow
// decided (stages). What it could not say is what the HOST did: an RPC that
// threw, a CLI verb that refused, a run that failed without a reason, a spawn
// loop that restarted the worker 150 times. Those facts lived in server logs a
// reader never opens, so a card that was quietly broken looked idle.
//
// Loaded on request, never on open: the answer is a database read the reader
// did not ask for yet, and a section that starts closed must not spend a query
// proving it has nothing to show. Same posture as the shared-files check.
type Activity = z.infer<typeof rpcContract.cardActivity.output>;
type Row = Activity["rows"][number];

const LEVEL_TONE: Record<string, string> = {
  error: "text-destructive",
  refused: "text-warning",
  partial: "text-warning",
};

export function CardActivity({ cardId }: { cardId: string }) {
  const { activity, loading, load } = useActivity(cardId);
  return (
    <DisclosureSection
      title="Activity"
      subtitle="what the plugin recorded doing on this card"
      hint={activity ? `${activity.events} recorded ${activity.events === 1 ? "event" : "events"}` : undefined}
      action={
        activity ? null : (
          <Button variant="ghost" size="sm" onClick={load} disabled={loading} className="min-h-11">
            {loading ? "Loading…" : "Load activity"}
          </Button>
        )
      }
    >
      {activity === null ? null : activity.rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ul className="space-y-1">
          {activity.rows.map((row) => (
            <ActivityRow key={`${row.kind}-${row.at}-${row.cause ?? ""}`} row={row} />
          ))}
        </ul>
      )}
    </DisclosureSection>
  );
}

function ActivityRow({ row }: { row: Row }) {
  const count = row.occurrences > 1 ? ` x${row.occurrences}` : "";
  const cause = row.cause ? ` ${row.cause}` : "";
  const duration = formatActionDuration(row);
  // A repeated row shows the last time it happened, because that is the
  // question the reader has ("is it still happening?"); the first moment is
  // one click away in `bb stelow log --kind <kind>`.
  const when = formatActionTime(row.occurrences > 1 ? row.lastAt : row.at);
  return (
    <li className="text-xs text-muted-foreground">
      <span className="tabular-nums">{when}</span>
      {" · "}
      <span className={LEVEL_TONE[row.outcome] ?? "text-foreground"}>
        {row.kind}{cause}{count}
      </span>
      <span>{duration ? ` · ${duration.trim()}` : ""}</span>
      {summarizeDetail(row.detail) ? (
        <span className="block pl-4 text-muted-foreground">{summarizeDetail(row.detail).trim()}</span>
      ) : null}
    </li>
  );
}

function useActivity(cardId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setActivity(await rpc.call("cardActivity", { cardId, limit: 50 }));
    } catch {
      setActivity({ rows: [], events: 0 });
    } finally {
      setLoading(false);
    }
  }, [rpc, cardId]);
  return { activity, loading, load };
}
