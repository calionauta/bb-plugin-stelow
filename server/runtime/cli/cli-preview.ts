import { previewText } from "../../../lib/preview-session.mjs";
import {
  refuse,
  usage,
  type CliCommandFn,
  type CliResult,
  type CliRunContext,
  type Refusal,
} from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";
import type { WorkerCard } from "../../workers-types.js";

const USAGE =
  "Usage: bb stelow preview [status|start|stop] [--card <card_id>] [--json]";

type PreviewAction = "status" | "start" | "stop";

/** Worker-facing preview control: the same decisions the panel uses, so a
 * worker can start, inspect, and stop the dev server it just built. The
 * checkout is the identity, so two cards on one workspace share it. */
export function createPreviewCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "preview") return null;
    const args = argv.slice(1);
    const action = (["status", "start", "stop"].includes(args[0] ?? "")
      ? args[0]
      : "status") as PreviewAction;
    const json = args.includes("--json");
    let cardId: string | null = null;
    for (let index = 0; index < args.length; index++) {
      if (args[index] === "--card") {
        cardId = args[index + 1] ?? null;
        index++;
        continue;
      }
      if (args[index]!.startsWith("--")) return usage(USAGE);
    }
    const card = previewCard(deps, cardId, ctx);
    if ("refusal" in card) return card.refusal;
    return previewAction(deps, card, action, json);
  };
}

function previewCard(
  deps: CliDeps,
  cardId: string | null,
  ctx: CliRunContext,
): WorkerCard | Refusal {
  const card = cardId
    ? deps.getCard(cardId)
    : ctx.threadId
      ? deps.getCardByWorkerThread(ctx.threadId)
      : undefined;
  if (!card)
    return refuse({
      exitCode: 1,
      stderr:
        "No card found. Pass --card <card_id>, or run this from a card's worker thread.",
    });
  return card;
}

async function previewAction(
  deps: CliDeps,
  card: WorkerCard,
  action: PreviewAction,
  json: boolean,
): Promise<CliResult> {
  if (action === "start" || action === "stop") {
    const result =
      action === "start"
        ? await deps.preview.start(card.id)
        : await deps.preview.stop(card.id);
    const view = await deps.preview.view(card.id);
    if (json)
      return { exitCode: result.ok ? 0 : 1, stdout: `${JSON.stringify(view)}\n` };
    if (!result.ok)
      return { exitCode: 1, stderr: `${result.error ?? `${action} failed`}\n` };
    return { exitCode: 0, stdout: previewText(view) };
  }
  const view = await deps.preview.view(card.id);
  if (json) return { exitCode: 0, stdout: `${JSON.stringify(view)}\n` };
  if (!view.available)
    return {
      exitCode: 1,
      stderr: `${view.error ?? "No web app detected in this workspace."}\n`,
    };
  return { exitCode: 0, stdout: previewText(view) };
}
