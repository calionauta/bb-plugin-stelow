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
 *
 * Bundling rule (one strategy for every dependency): a tool ships as a plugin
 * `dependencies` entry only when its package survives bb's git-install flags
 * (`npm install --omit=dev --omit=optional --ignore-scripts`) with its binary
 * intact — pure JS, no lifecycle scripts, no per-platform optional packages.
 * `pele` passes and is bundled. `@ast-grep/cli` provably does not (its binary
 * arrives via per-platform `optionalDependencies` plus a postinstall, both
 * skipped), and `cymbal`/`ripwire`/`sem`/`xerj` are not npm packages at all —
 * so those stay on the pinned, verified, isolated host installers below, one
 * click in About, never a silent global requirement. NPX skills need no
 * install (auto-install per use); version pins for those live upstream in the
 * skill references, not here.
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
    install: "curl -fsSL https://xerj.org/get | sh   # then, with a node running (xerj --insecure --data-dir ~/.xerj-data &): xerj autoindex .",
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

/** Ids in panel order whose probe reads absent (or unknown). Pure. */
export function missingToolIds(tools) {
  if (!Array.isArray(tools)) return [];
  return tools.filter((tool) => tool && tool.present !== true).map((tool) => tool.id);
}

/**
 * One explicit action installs every missing tool in panel order, stopping at
 * nothing: a failure is recorded per tool and the loop continues, because one
 * refused installer must not hide the tools behind it. `call` is the RPC
 * (`(id) => rpc.call("installTool", { id })`), injected so a test drives the
 * whole sequence without a host. Resolves `{ ok, failed }`, never throws: an
 * install loop that throws on the first broken pipe is the reason installs
 * used to end with three silent rows.
 */
export async function installAllTools(call, ids) {
  const ok = [];
  const failed = {};
  for (const id of ids ?? []) {
    if (!isHostToolId(id)) continue;
    try {
      const result = await call(id);
      if (result && result.ok) ok.push(id);
      else failed[id] = (result && result.log) || "Install failed.";
    } catch (error) {
      failed[id] = toolErrorMessage(error);
    }
  }
  return { ok, failed };
}
