import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { StrategyPicker } from "@/components/creation/strategy-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ResearchStrategyOption } from "@/components/creation/creation-settings";
import type { rpcContract } from "../../server";

export type ResearchIndexState = {
  found: boolean;
  indexPath: string | null;
  content: string | null;
  truncated: boolean;
  opportunities: Array<{ id: string; title: string; checked: boolean; group: string | null }>;
  rounds: Array<{
    n: number;
    strategyId: string;
    label: string;
    emoji: string;
    at: string;
    status: "ready" | "pending" | "missing";
    missing: string[];
    substeps: Array<{ slug: string; status: "ready" | "missing" | "invalid" | "needs-depth" }>;
    files: Array<{ display: string; path: string; absolutePath: string; hostId: string; generatedAt: string }>;
  }>;
  error: string | null;
};

type ResearchRpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type ResearchOpportunity = ResearchIndexState["opportunities"][number];

type FanOutDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  cardId: string;
  opportunities: ResearchOpportunity[];
  onFanned: () => void;
};

function useFanOutSelection(open: boolean) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  // Opportunities are a fresh array on every parent render (realtime index
  // reloads), so only the open transition may reset the user's selection.
  useEffect(() => {
    if (!open) return;
    setSelected({});
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return { selected, setSelected, busy, setBusy };
}

function opportunityGroups(opportunities: ResearchOpportunity[]): string[] {
  const seen: string[] = [];
  for (const item of opportunities) {
    const group = item.group ?? "Opportunities";
    if (!seen.includes(group)) seen.push(group);
  }
  return seen;
}

function FanOutOpportunityList({ available, selected, busy, onToggle }: {
  available: ResearchOpportunity[];
  selected: Record<string, boolean>;
  busy: boolean;
  onToggle: (id: string, selected: boolean) => void;
}) {
  if (available.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing available — every opportunity was already fanned out or checked.</p>;
  }
  const groups = opportunityGroups(available);
  return (
    <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border">
      {groups.map((group) => (
        <li key={group}>
          <p className="bg-muted/40 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{group}</p>
          {available.filter((item) => (item.group ?? "Opportunities") === group).map((item) => (
            <label key={item.id} className="flex cursor-pointer items-start gap-2 p-2 hover:bg-muted/40">
              <input
                className="mt-1 h-4 w-4 shrink-0 cursor-pointer"
                type="checkbox"
                checked={Boolean(selected[item.id])}
                onChange={() => onToggle(item.id, !selected[item.id])}
                disabled={busy}
              />
              <span className="min-w-0 text-sm leading-5">{item.title}</span>
            </label>
          ))}
        </li>
      ))}
    </ul>
  );
}

async function confirmFanOut(rpc: ResearchRpc, props: FanOutDialogProps, chosen: ResearchOpportunity[]) {
  const result = await rpc.call("fanOutResearch", { cardId: props.cardId, opportunityIds: chosen.map((item) => item.id) });
  if (!result.ok) {
    toast.error(result.error ?? "Could not create build cards.");
    if (result.created.length > 0) {
      props.onOpenChange(false);
      props.onFanned();
    }
    return;
  }
  toast.success(`Created ${result.created.length} ${result.created.length === 1 ? "build card" : "build cards"}.`);
  props.onOpenChange(false);
  props.onFanned();
}

// Fan-out turns checked opportunities into build cards. The server reparses
// the index, spawns the selected work, and marks exactly those boxes.
export function FanOutDialog(props: FanOutDialogProps) {
  const rpc = useRpc<typeof rpcContract>();
  const { selected, setSelected, busy, setBusy } = useFanOutSelection(props.open);
  const available = props.opportunities.filter((item) => !item.checked);
  const chosen = available.filter((item) => selected[item.id]);

  async function confirm() {
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      await confirmFanOut(rpc, props, chosen);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Select To Build</DialogTitle>
          <DialogDescription>Select which opportunities become build cards (starting at triage) — nothing is created until you confirm. Created cards are marked here so retrying never duplicates them.</DialogDescription>
        </DialogHeader>
        <FanOutOpportunityList
          available={available}
          selected={selected}
          busy={busy}
          onToggle={(id, next) => setSelected((previous) => ({ ...previous, [id]: next }))}
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>Cancel</Button>
          </DialogClose>
          <Button onClick={() => void confirm()} disabled={busy || chosen.length === 0}>{busy ? "Creating…" : chosen.length === 0 ? "Select opportunities" : `Create ${chosen.length} ${chosen.length === 1 ? "card" : "cards"}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type StrategyRunDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  cardId: string;
  strategies: ResearchStrategyOption[];
  runIds: string[];
  onStarted: () => void;
};

function openedStrategy(current: string | null, strategies: ResearchStrategyOption[], runIds: string[]) {
  return current ?? strategies.find((entry) => !runIds.includes(entry.id))?.id ?? strategies[0]?.id ?? null;
}

async function confirmStrategyRun(rpc: ResearchRpc, props: StrategyRunDialogProps, active: ResearchStrategyOption) {
  const result = await rpc.call("runResearchStrategy", { cardId: props.cardId, strategy: active.id });
  if (!result.ok) {
    toast.error(result.error ?? "Could not start the strategy round.");
    return;
  }
  toast.success(`Started a ${active.label} research round. Results will be added to this card.`);
  props.onOpenChange(false);
  props.onStarted();
}

// Composite research runs one additional strategy round against the same
// request. Rounds append to the index rather than forming a parallel batch.
export function StrategyRunDialog(props: StrategyRunDialogProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!props.open) return;
    setBusy(false);
    setPicked((current) => openedStrategy(current, props.strategies, props.runIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);
  const active = props.strategies.find((entry) => entry.id === picked) ?? null;

  async function confirm() {
    if (!active) return;
    setBusy(true);
    try {
      await confirmStrategyRun(rpc, props, active);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Explore another strategy</DialogTitle>
          <DialogDescription>A fresh worker applies another approach to the same request. Its findings are added without overwriting existing results.</DialogDescription>
        </DialogHeader>
        <StrategyPicker strategies={props.strategies} value={picked} onChange={setPicked} runIds={props.runIds} groupName="research-strategy-round" disabled={busy} />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>Cancel</Button>
          </DialogClose>
          <Button onClick={() => void confirm()} disabled={busy || !active}>{busy ? "Starting…" : active ? `Run ${active.label}` : "Pick a strategy"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
