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

export function formatAffectedTests(tests) {
  if (!Array.isArray(tests) || tests.length === 0) return null;
  const head = tests.slice(0, 5).map((test) => {
    const name = test?.name ?? "?";
    const file = test?.file ?? "?";
    return `${name} (${file})`;
  }).join("; ");
  const rest = tests.length - 5;
  return rest > 0 ? `${head} · +${rest} more` : head;
}

export function formatTestGate(gate) {
  if (!gate || typeof gate !== "object" || Array.isArray(gate) || Object.keys(gate).length === 0) return null;
  if (gate.obligations) {
    const toRun = Array.isArray(gate.testsToRun) ? gate.testsToRun : [];
    const head = toRun.slice(0, 5).join(", ");
    const rest = toRun.length - 5;
    const tail = rest > 0 ? ` · +${rest} more` : "";
    return `Run: ${head}${tail} (${gate.untested ?? 0} untested)`;
  }
  return `${gate.tests ?? 0} tests · no pending obligations`;
}

export function formatQualityGate(gate) {
  if (!gate || typeof gate !== "object" || Array.isArray(gate)) return null;
  if (gate.blocked) {
    return `Quality: ${gate.regressions ?? 0} regressions · ${gate.gating ?? 0} gating`;
  }
  return "Quality: no new regressions";
}

export function commitFileState(file) {
  if (file.binary) return " · binary";
  if (!file.patch) {
    return file.loadMode === "too_large" ? " · too large" : " · no patch";
  }
  return "";
}
