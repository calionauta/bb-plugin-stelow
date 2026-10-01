import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { goToExecutionRun } from "../app-support/navigation";
import { stageLabel } from "../../lib/workflow-vocabulary.mjs";
import type { ExecutionRun } from "./use-execution-runs";
import type { RunCard } from "./execution-run-row-types";

/**
 * One action button on a run row.
 *
 * Three controls shared a hand-written `<button>` each, differing only in tone
 * and label — which is how "min-h-11 and a cursor-pointer on every clickable"
 * became three places to remember instead of one. The tone is a name, not a
 * class, so a fourth action cannot invent a fourth shape.
 */
function RunButton({
  tone = "plain",
  label,
  busyLabel,
  title,
  busy,
  onClick,
}: {
  tone?: "plain" | "destructive" | "primary";
  label: string;
  busyLabel?: string;
  title?: string;
  busy?: boolean;
  onClick: () => void;
}) {
  const toneClass = {
    plain: "hover:bg-muted",
    destructive: "text-destructive hover:bg-muted",
    primary: "font-medium text-primary hover:bg-muted",
  }[tone];
  return (
    <button
      type="button"
      title={title}
      disabled={busy}
      className={`min-h-11 cursor-pointer rounded-md border px-3 text-xs ${toneClass}`}
      onClick={onClick}
    >
      {busy && busyLabel ? busyLabel : label}
    </button>
  );
}

export type RunActionProps = {
  card: RunCard;
  run: ExecutionRun;
  active: boolean;
  stopping: boolean;
  retrying: boolean;
  /** True on the one row the advance gate is holding the card for. */
  blocking: boolean;
  onCancel: (runId: string) => void | Promise<void>;
  onRetry: (runId: string) => void | Promise<void>;
};

/**
 * What a person can do with a run: open its transcript, stop it, or retry it.
 *
 * Its own file because these are the run row's CONTROLS, and a section that
 * draws a list of runs has no business knowing how a button is toned. The
 * section passed 400 lines when they lived together, and the shape gate was
 * right: a list and a control set are two things.
 */
export function RunActions({ card, run, active, stopping, retrying, blocking, onCancel, onRetry }: RunActionProps) {
  const navigate = useBbNavigate();
  return (
    <div className="flex shrink-0 items-center gap-2">
      <RunButton label="Open" onClick={() => goToExecutionRun(navigate, card, run)} />
      {active ? (
        <RunButton
          tone="destructive"
          label="Stop"
          busyLabel="Stopping…"
          busy={stopping}
          onClick={() => void onCancel(run.id)}
        />
      ) : null}
      {/* The door in the failed-run hold. A stage whose newest run failed cannot
          be advanced out of, and the refusal names "Retry run" — so this button
          is what makes that sentence true rather than a dead end.

          It appears on the BLOCKING row and no other. The server says which run
          that is, by the rule the gate itself uses, so this button is never a
          control the server will refuse: a failed run from a stage the card has
          left is history, and offering Retry there produced a button whose only
          outcome was an error explaining that the card had moved on. */}
      {blocking ? (
        <RunButton
          tone="primary"
          label="Retry run"
          busyLabel="Retrying…"
          busy={retrying}
          title={`Run ${stageLabel(run.stage)} again`}
          onClick={() => void onRetry(run.id)}
        />
      ) : null}
    </div>
  );
}
