export function joinStrategyLabels(ids, byId) {
  const labels = [];
  for (const id of ids) {
    const label = (id && byId.get(id)) || id;
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels.length > 0 ? labels.join(" + ") : null;
}

export function statusTone(status) {
  if (["completed", "done"].includes(status)) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (["in-progress", "approved"].includes(status)) return "bg-primary/15 text-primary";
  if (["blocked", "failed"].includes(status)) return "bg-destructive/15 text-destructive";
  if (status === "escalated") return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  if (["skipped", "archived"].includes(status)) return "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300";
  return "bg-muted text-muted-foreground";
}

export function liveBorderClass(card) {
  if (card.activity === "running") return "stelow-border-running";
  if (card.activity === "awaiting-answer" || card.needsAttention) return "stelow-border-attention";
  return "";
}
