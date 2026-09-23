export function shouldShowBuildDiff({ status, stage, publicationDirty, recoveryKind }) {
  if (status !== "completed") return stage === "diff-gate" || stage === "audit";
  return publicationDirty || recoveryKind === "attached";
}

export function formatEntitySummary(summary) {
  if (!summary || summary.total <= 0) return null;
  const parts = [
    summary.added > 0 ? `${summary.added} added` : null,
    summary.modified > 0 ? `${summary.modified} modified` : null,
    summary.deleted > 0 ? `${summary.deleted} deleted` : null,
    summary.renamed > 0 ? `${summary.renamed} renamed` : null,
    summary.moved > 0 ? `${summary.moved} moved` : null,
  ].filter((part) => part !== null);
  const head = `${summary.total} ${summary.total === 1 ? "entity" : "entities"}`;
  const tail = summary.cosmeticOnly ? " · cosmetic only" : "";
  return parts.length > 0 ? `${head} · ${parts.join(" · ")}${tail}` : `${head}${tail}`;
}

export function formatChangedSymbols(symbols) {
  if (!symbols || symbols.length === 0) return null;
  return symbols.map((entry) => {
    const impact = entry.callers === 0
      ? "no callers"
      : `${entry.callers} caller${entry.callers === 1 ? "" : "s"}${entry.testCallers > 0 ? ` (${entry.testCallers} test${entry.testCallers === 1 ? "" : "s"})` : ""}`;
    return `${entry.symbol} · ${impact}`;
  }).join("; ");
}
