/**
 * The optional host tools, one list for both halves of the About panel's
 * promise: the vocabulary the installer and the probe agree on
 * (`HOST_TOOL_IDS`) and the copy a person reads (`HOST_TOOLS`).
 *
 * `HOST_TOOLS` carries the row's identity and its human command; the pinned
 * install the plugin itself performs lives in `server/runtime/tool-installers.ts`.
 * A tool in one list and not the other is a bug — `tests/host-tools.test.mjs`
 * asserts they match, because a row that cannot install and a tool that cannot
 * be seen are both silent failures.
 */
export const HOST_TOOL_IDS = Object.freeze([
  "ast-grep",
  "cymbal",
  "ripwire",
  "sem",
  "xerj",
]);

export const HOST_TOOLS = Object.freeze([
  {
    id: "ast-grep",
    name: "ast-grep",
    repo: "https://github.com/ast-grep/ast-grep",
    plain: "Find code patterns and rename across files without touching text inside strings — when refactoring.",
    tech: "Structural AST search with safe rewrite; used for refactors that change signatures.",
    install: "npm install -g @ast-grep/cli",
  },
  {
    id: "cymbal",
    name: "cymbal",
    repo: "https://github.com/1broseidon/cymbal",
    plain: "See who calls each function and what breaks if you change it — before touching code.",
    tech: "Symbol graph (refs, impact, trace); used in Tech Preview, Feature Recon and Alignment Check.",
    install: "brew install 1broseidon/tap/cymbal",
  },
  {
    id: "ripwire",
    name: "ripwire",
    repo: "https://github.com/redhat-et/ripwire",
    plain: "First read of an unfamiliar codebase: what matters, where to enter, what to test.",
    tech: "Token-budgeted symbol map (symbols, callers, blast radius).",
    install: "RIPWIRE_REPO=redhat-et/ripwire bash -c \"$(curl -fsSL \\\n      https://raw.githubusercontent.com/redhat-et/ripwire/main/scripts/install.sh)\"",
  },
  {
    id: "sem",
    name: "sem",
    repo: "https://github.com/Ataraxy-Labs/sem",
    plain: "Tell which functions and types changed — not just which lines — including renames.",
    tech: "Entity-level diff via tree-sitter; powers the Diff summary and agent audits.",
    install: "curl -fsSL https://raw.githubusercontent.com/Ataraxy-Labs/sem/main/install.sh | sh",
  },
  {
    id: "xerj",
    name: "xerj",
    repo: "https://github.com/xerj-org/xerj",
    plain: "Ask a large docs tree or a corpus of peer projects by meaning — when grep is too literal.",
    tech: "Hybrid (BM25 + semantic) retrieval over an indexed folder or a peer corpus; binary probed, not the node. Degrades to grep.",
    install: "curl -fsSL https://xerj.org/get | sh   # then: xerj autoindex .",
  },
]);

function isHostToolId(id) {
  return HOST_TOOL_IDS.includes(id);
}

function toolErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" && error.trim() ? error : "Install failed.";
}

export function beginToolInstall(errors, id) {
  if (!(id in errors)) return errors;
  const next = { ...errors };
  delete next[id];
  return next;
}

export function finishToolInstall(errors, id, error) {
  if (!isHostToolId(id)) return errors;
  return { ...errors, [id]: toolErrorMessage(error) };
}

export function clearToolError(errors, id) {
  return beginToolInstall(errors, id);
}

export function mergeToolStatuses(previous, next) {
  if (!Array.isArray(next)) return previous;
  const valid = next.filter((tool) => (
    tool !== null
    && typeof tool === "object"
    && isHostToolId(tool.id)
    && typeof tool.present === "boolean"
    && (tool.version === null || typeof tool.version === "string")
  ));
  return valid.length > 0 ? valid : previous;
}
