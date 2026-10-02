import { useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import { Button } from "@/components/ui/button";
import { DisclosureSection } from "../disclosure";

/**
 * Catch up: what changed on this card since the reader last looked.
 *
 * A DETERMINISTIC delta with optional phrasing — the facts come from rows that
 * already exist (`lib/card-catch-up.mjs`), and a generation-tier model may only
 * rephrase them (`lib/card-briefing.mjs`). So the facts are always rendered, and
 * the prose appears above them when a model produced some.
 *
 * It loads on demand rather than on open, because a briefing costs a spawn and
 * most card opens are not a return after a gap. Closed by default for the same
 * reason every non-live section here is.
 *
 * The section is labelled a summary of what the card recorded, never a channel.
 * The card renamed "Conversation" to "Notes for the agent" for exactly this
 * reason: a briefing that read as a conversation would invite answers nobody is
 * reading, and this surface has no reply path at all.
 */
export function CatchUpSection({ cardId }: { cardId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<CatchUpState>({ phase: "idle" });

  async function load() {
    setState({ phase: "loading" });
    try {
      const result = await rpc.call("catchUp", { cardId });
      setState(result.ok
        ? { phase: "ready", result }
        : { phase: "error", message: result.error ?? DEFAULT_ERROR });
    } catch (error) {
      setState({ phase: "error", message: error instanceof Error ? error.message : DEFAULT_ERROR });
    }
  }

  return (
    <DisclosureSection
      title="Catch up"
      subtitle="What changed since you last looked"
      hint={state.phase === "ready" ? `${state.result.facts.length}` : undefined}
      action={
        <Button
          size="sm"
          variant="outline"
          className="cursor-pointer"
          disabled={state.phase === "loading"}
          onClick={() => void load()}
        >
          {state.phase === "loading" ? "Reading…" : "Catch up"}
        </Button>
      }
    >
      <CatchUpIntro state={state} />
      {state.phase === "ready" ? <CatchUpBody result={state.result} /> : null}
    </DisclosureSection>
  );
}

const DEFAULT_ERROR = "Could not read this card's changes.";

type CatchUpState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; result: CatchUpPayload };

/** The section's own words before anything is read, or the reason it failed. */
function CatchUpIntro({ state }: { state: CatchUpState }) {
  if (state.phase === "idle") {
    return (
      <p className="text-xs leading-5 text-muted-foreground">
        Reads this card&apos;s own record — stage moves, questions, stalls and
        completions — and reports only what happened since your last read.
      </p>
    );
  }
  if (state.phase === "error") {
    return <p className="text-xs leading-5 text-destructive">{state.message}</p>;
  }
  return null;
}

type CatchUpPayload = {
  summary: string | null;
  prose: string | null;
  source: string | null;
  facts: Array<{
    kind: string;
    at: number;
    text: string | null;
    stage: string | null;
    open: boolean | null;
  }>;
};

function CatchUpBody({ result }: { result: CatchUpPayload }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-foreground">{result.summary}</p>
      {/* The prose is the model's phrasing of the facts below it. When there is
          none, the facts are the whole answer — which is why the source is only
          shown when it explains an absence rather than reporting a failure. */}
      {result.prose ? (
        <p className="text-xs leading-5 text-muted-foreground">{result.prose}</p>
      ) : null}
      {result.facts.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing to list — this card has not moved since then.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {result.facts.map((fact, index) => (
            <li
              key={`${fact.kind}-${fact.at}-${index}`}
              className="flex items-baseline gap-2 text-xs text-muted-foreground"
            >
              <span className="shrink-0 tabular-nums">{formatWhen(fact.at)}</span>
              <span className="min-w-0 text-foreground">{factLine(fact)}</span>
              {fact.open ? (
                <span className="shrink-0 font-medium text-amber-700 dark:text-amber-300">
                  waiting on you
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One fact, in the words the card already uses for it. */
function factLine(fact: CatchUpPayload["facts"][number]): string {
  if (fact.kind === "stage") return `moved to ${fact.stage}`;
  if (fact.kind === "question") return `asked: ${fact.text ?? ""}`;
  if (fact.kind === "answer") return `you answered: ${fact.text ?? ""}`;
  if (fact.kind === "blocked") return `stalled: ${fact.text ?? ""}`;
  if (fact.kind === "error") return `failed: ${fact.text ?? ""}`;
  if (fact.kind === "completed") return `finished and awaiting your read`;
  return fact.text ?? fact.kind;
}

function formatWhen(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
