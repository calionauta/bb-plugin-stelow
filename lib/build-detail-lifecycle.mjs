const unsuccessful = (error, extra = {}) => ({ ok: false, error, ...extra });
const successful = (success, extra = {}) => ({ ok: true, success, ...extra });

function destructiveOutcome(action, result) {
  if (action === "archive") return result.archived
    ? successful("Card archived.", { close: true })
    : unsuccessful("Archive did not take — the card is gone.");
  if (action === "delete") return result.deleted
    ? successful("Card deleted.", { close: true })
    : unsuccessful(result.error ?? "Delete failed.");
  return result.ok
    ? successful(result.summary ?? "Card work discarded.", { close: true })
    : unsuccessful(result.error ?? "Discard failed.");
}

function handoffOutcome(action, result) {
  if (action === "promote") return result.ok
    ? successful(
      `Project "${result.projectName}" created — a new project worker is continuing the workflow.`,
      { refresh: true },
    )
    : unsuccessful(result.error ?? "Could not turn into project.");
  if (action === "attach-recovery") return result.ok
    ? successful(
      "Checkout attached for review. No files, branch, or Git history were changed.",
      { refresh: true, refreshRecovery: true },
    )
    : unsuccessful(result.error ?? "Could not attach the checkout.");
  if (!result.ok || !result.auditCardId) {
    return unsuccessful(result.error ?? "Could not create the recovery audit.");
  }
  return successful(
    "Recovery audit started in the registered project workspace.",
    { refresh: true, refreshRecovery: true, auditCardId: result.auditCardId },
  );
}

function workerOutcome(action, result, context) {
  if (action === "repair") {
    if (!result.reseeded) return unsuccessful(result.error ?? "Restart failed");
    const message = result.reclassified
      ? `Workflow reclassified as ${context.intentLabels?.[context.intent ?? ""] ?? context.intent} and restarted from triage.`
      : "Fresh worker started from triage.";
    return successful(message, { refresh: true });
  }
  if (action === "retry") return result.ok
    ? successful("Worker retried — continuing from the current stage.", { refresh: true })
    : unsuccessful(result.error ?? "Retry failed. Try Restart fresh instead.", { refresh: true });
  if (action === "restart") return result.ok
    ? successful("Worker restarted — continuing from the current stage.", { refresh: true })
    : unsuccessful(result.error ?? "Restart failed.", { refresh: true });
  if (action === "start") return result.ok
    ? successful("Worker started — the card moved from Bucket and is triaging.", { refresh: true })
    : unsuccessful(result.error ?? "Start failed.", { refresh: true });
  return result.ok
    ? successful("Split requested — answer the worker's proposal on this card.", { refresh: true })
    : unsuccessful(result.error ?? "Could not request a split.");
}

const OUTCOME_BUILDERS = {
  archive: destructiveOutcome,
  delete: destructiveOutcome,
  discard: destructiveOutcome,
  promote: handoffOutcome,
  "attach-recovery": handoffOutcome,
  "create-recovery-audit": handoffOutcome,
  repair: workerOutcome,
  retry: workerOutcome,
  restart: workerOutcome,
  start: workerOutcome,
  split: workerOutcome,
};

export function buildLifecycleOutcome(action, result, context = {}) {
  const build = OUTCOME_BUILDERS[action];
  if (!build) throw new Error(`Unknown Build lifecycle action: ${action}`);
  return build(action, result, context);
}

export function buildDiscardConfirmation(preview) {
  if (!preview.eligible) return { eligible: false, error: preview.reason ?? "Nothing safe to discard." };
  return {
    eligible: true,
    confirmation: {
      title: preview.confirmTitle ?? "Discard this card’s work?",
      body: preview.confirmBody ?? "",
    },
  };
}
