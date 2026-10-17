import { toast } from "sonner";

type Rpc = { call: (method: "startWorker" | "restartWorker", args: { cardId: string }) => Promise<{ ok: boolean; error?: string | null }> };

export async function runTrackStart(
  rpc: Rpc,
  cardId: string,
  onChanged: () => void,
  trackNoun: "exploration" | "research",
  setStarting: (value: boolean) => void,
) {
  setStarting(true);
  try {
    const result = await rpc.call("startWorker", { cardId });
    if (!result.ok) toast.error(result.error ?? "Start failed.");
    else toast.success(`Worker started — the ${trackNoun === "exploration" ? "exploration" : "research"} is now Doing.`);
    onChanged();
  } finally {
    setStarting(false);
  }
}

export async function runTrackRestart(
  rpc: Rpc,
  cardId: string,
  onChanged: () => void,
  trackNoun: "exploration" | "research",
  setRestarting: (value: boolean) => void,
) {
  setRestarting(true);
  try {
    const result = await rpc.call("restartWorker", { cardId });
    if (!result.ok) toast.error(result.error ?? "Restart failed.");
    else toast.success(`Worker restarted — continuing the ${trackNoun}.`);
    onChanged();
  } finally {
    setRestarting(false);
  }
}
