/**
 * Deterministic depth validation over markdown artifacts. Pure functions
 * interpreting the check DSL from lib/artifact-contracts.mjs — no I/O,
 * no model judgment. validateArtifact returns { pass, failures[] } where
 * each failure is { code, expected, found, detail } with a human-readable
 * expected-vs-found line for verify/done/inbox rendering.
 *
 * Check DSL. A contract carries an optional `minWords` floor plus `checks[]`;
 * every check has a `kind` dispatched by CHECKS_BY_KIND below, and a kind it
 * does not know is a contract bug, not a passing document:
 * - { kind: "headings", level, min, max?, startsWith?, contains? }
 * - { kind: "named-headings", level (null = any), names, match }
 * - { kind: "contains", needles }
 * - { kind: "section-items", heading, min }
 * - { kind: "field-blocks", marker, fields, minBlocks }
 * - { kind: "table-rows", min }
 * - { kind: "table-columns", names }
 * - { kind: "gap-registry" }
 */
import { contractForSubstep, contractForExplore, contractForBuildArtifact } from "./artifact-contracts.mjs";
import { parseArtifactManifest } from "./artifact-manifest.mjs";
import { validateGapRegistry } from "./gap-registry.mjs";

export function wordCount(text) {
  return String(text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

function headingLines(text) {
  return String(text ?? "").split("\n").map((line) => {
    const match = line.match(/^(#{1,6})\s+(.*?)\s*$/);
    return match ? { level: match[1].length, text: match[2].replace(/:$/, "").trim() } : null;
  }).filter(Boolean);
}

function isTableSeparator(line) {
  return /^\s*\|?[\s:|-]+\|[\s:|.-]*$/.test(line) && line.includes("-");
}

/** Data rows across all markdown tables (excludes header + separator). */
export function tableRowCount(text) {
  const lines = String(text ?? "").split("\n");
  let rows = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("|") || isTableSeparator(line)) continue;
    const next = (lines[i + 1] ?? "").trim();
    if (next.startsWith("|") && isTableSeparator(next)) continue;
    rows++;
  }
  return rows;
}

/** Bullets (`-`/`*`/numbered) under a heading until the next heading. */
export function sectionItemCount(text, heading) {
  const lines = String(text ?? "").split("\n");
  const needle = String(heading ?? "").toLowerCase();
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.*?)\s*$/);
    if (match && match[2].toLowerCase().includes(needle)) {
      start = i;
      level = match[1].length;
      break;
    }
  }
  if (start < 0) return 0;
  let items = 0;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(#{1,6})\s+/);
    if (match && match[1].length <= level) break;
    if (/^\s*([-*]|\d+[.)])\s+\S/.test(line)) items++;
  }
  return items;
}

/** Marker-headed blocks (e.g. #### criteria) containing every field line. */
export function fieldBlockCount(text, marker, fields) {
  const lines = String(text ?? "").split("\n");
  const markerLevel = (marker.match(/#/g) ?? []).length || 6;
  let blocks = 0;
  let inBlock = false;
  let seen = new Set();
  const close = () => {
    if (inBlock && fields.every((field) => seen.has(field))) blocks++;
    inBlock = false;
    seen = new Set();
  };
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+/);
    if (match && match[1].length <= markerLevel) {
      close();
      if (line.startsWith(marker)) {
        inBlock = true;
      }
      continue;
    }
    if (!inBlock) continue;
    for (const field of fields) {
      if (line.includes(field)) seen.add(field);
    }
  }
  close();
  return blocks;
}

function checkMinWords(text, min) {
  const found = wordCount(text);
  return found >= min ? null : { code: "thin", expected: `at least ${min} words`, found: `${found} words`, detail: `expected at least ${min} words, found ${found}` };
}

function checkHeadings(text, check) {
  const all = headingLines(text).filter((heading) => check.level == null || heading.level === check.level)
    .filter((heading) => !check.startsWith || heading.text.toLowerCase().startsWith(check.startsWith.toLowerCase()))
    .filter((heading) => !check.contains || heading.text.toLowerCase().includes(check.contains.toLowerCase()));
  const levelName = check.level == null ? "headings" : `level-${check.level} headings`;
  if (check.min != null && all.length < check.min) {
    return { code: "too-few-headings", expected: `at least ${check.min} ${levelName}`, found: `${all.length}`, detail: `expected at least ${check.min} ${levelName}, found ${all.length}` };
  }
  if (check.max != null && all.length > check.max) {
    return { code: "too-many-headings", expected: `at most ${check.max} ${levelName}`, found: `${all.length}`, detail: `expected at most ${check.max} ${levelName}, found ${all.length}` };
  }
  return null;
}

function checkNamedHeadings(text, check) {
  const all = headingLines(text).filter((heading) => check.level == null || heading.level === check.level);
  const missing = check.names.filter((name) => {
    const needle = name.toLowerCase();
    return !all.some((heading) => {
      const hay = heading.text.toLowerCase();
      return check.match === "exact" ? hay === needle : hay.includes(needle);
    });
  });
  return missing.length === 0 ? null : {
    code: "missing-section",
    expected: `sections: ${check.names.join(", ")}`,
    found: `missing: ${missing.join(", ")}`,
    detail: `missing sections: ${missing.join(", ")}`,
  };
}

function checkContains(text, check) {
  const body = String(text ?? "").toLowerCase();
  const missing = (Array.isArray(check.needles) ? check.needles : []).filter((needle) => !body.includes(String(needle).toLowerCase()));
  return missing.length === 0 ? null : {
    code: "missing-content",
    expected: `contains: ${check.needles.join(", ")}`,
    found: `missing: ${missing.join(", ")}`,
    detail: `missing content: ${missing.join(", ")}`,
  };
}

function checkSectionItems(text, check) {
  const found = sectionItemCount(text, check.heading);
  return found >= check.min ? null : {
    code: "too-few-items",
    expected: `at least ${check.min} items under "${check.heading}"`,
    found: `${found}`,
    detail: `expected at least ${check.min} items under "${check.heading}", found ${found}`,
  };
}

function checkFieldBlocks(text, check) {
  const found = fieldBlockCount(text, check.marker, check.fields);
  return found >= check.minBlocks ? null : {
    code: "incomplete-blocks",
    expected: `${check.minBlocks} blocks with ${check.fields.join(", ")}`,
    found: `${found} complete`,
    detail: `expected ${check.minBlocks} blocks with ${check.fields.join(", ")}, found ${found} complete`,
  };
}

function checkTableRows(text, check) {
  const found = tableRowCount(text);
  return found >= check.min ? null : {
    code: "missing-table-rows",
    expected: `at least ${check.min} table rows`,
    found: `${found}`,
    detail: `expected at least ${check.min} table rows, found ${found}`,
  };
}

/** Header cells across all markdown tables (a header line is the `|...|`
 *  line directly above a separator line). Matching is case-insensitive
 *  and substring-based, like the named-headings contract. */
export function tableHeaders(text) {
  const lines = String(text ?? "").split("\n");
  const headers = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim();
    const next = (lines[i + 1] ?? "").trim();
    if (!line.startsWith("|") || isTableSeparator(line)) continue;
    if (!next.startsWith("|") || !isTableSeparator(next)) continue;
    for (const cell of line.split("|").map((part) => part.trim()).filter(Boolean)) {
      headers.push(cell.toLowerCase());
    }
  }
  return headers;
}

function checkTableColumns(text, check) {
  const headers = tableHeaders(text);
  const missing = (Array.isArray(check.names) ? check.names : [])
    .filter((name) => !headers.some((header) => header.includes(String(name).toLowerCase())));
  return missing.length === 0 ? null : {
    code: "missing-table-columns",
    expected: `table with columns: ${check.names.join(", ")}`,
    found: missing.length > 0 ? `missing columns: ${missing.join(", ")}` : "all columns present",
    detail: `expected a table with columns ${check.names.join(", ")}, missing ${missing.join(", ")} — a passing mention in prose is not a per-item criterion column`,
  };
}

/** One kind → its failures over a body. Adding a DSL kind is one entry here. */
const CHECKS_BY_KIND = {
  headings: (body, check) => [checkHeadings(body, check)].filter(Boolean),
  "named-headings": (body, check) => [checkNamedHeadings(body, check)].filter(Boolean),
  contains: (body, check) => [checkContains(body, check)].filter(Boolean),
  "section-items": (body, check) => [checkSectionItems(body, check)].filter(Boolean),
  "field-blocks": (body, check) => [checkFieldBlocks(body, check)].filter(Boolean),
  "table-rows": (body, check) => [checkTableRows(body, check)].filter(Boolean),
  "table-columns": (body, check) => [checkTableColumns(body, check)].filter(Boolean),
  "gap-registry": (body) => validateGapRegistry(body),
};

/** The kinds a contract may use — the surface tests/contract-integrity pins. */
export const CHECK_KINDS = Object.keys(CHECKS_BY_KIND);

/** Run one contract's checks over markdown text. */
export function validateArtifact(text, contract) {
  const failures = [];
  if (!contract) return { pass: true, failures };
  const body = typeof text === "string" ? text : "";
  if (typeof contract.minWords === "number") {
    const failure = checkMinWords(body, contract.minWords);
    if (failure) failures.push(failure);
  }
  for (const check of Array.isArray(contract.checks) ? contract.checks : []) {
    const run = CHECKS_BY_KIND[check.kind];
    if (!run) throw new Error(`unknown contract check kind: ${String(check.kind)}`);
    failures.push(...run(body, check));
  }
  return { pass: failures.length === 0, failures };
}

/** Validate a composite substep slug's content; unknown slugs pass (unmigrated). */
export function validateSubstep(slug, content) {
  return validateArtifact(content, contractForSubstep(slug));
}

/** Validate an explore stage's content; unknown stages pass (unmigrated). */
export function validateExplore(stageId, content) {
  return validateArtifact(content, contractForExplore(stageId));
}

/** Map a validation outcome + evidence to a seal status (provenance, not truth). */
export function sealStatus(valid, evidence) {
  if (!valid) return "unverified";
  if (!valid.pass) return "needs-revision";
  return evidence === "hypothesis-only" ? "hypothesis-only" : "verified";
}

/**
 * Depth failures for recognized Build documents registered in state.md.
 * readContent(path) returns file content or null. Only documents matching a
 * known shape are checked — unknown files, missing/empty content, audit.md,
 * receipts, and state bookkeeping never block. Returns
 * [{ path, label, failures[] }] with at most 3 detail lines each.
 */
export function buildDocDepths(stateBlob, readContent) {
  const out = [];
  const entries = parseArtifactManifest(stateBlob).filter((fields) => typeof fields.path === "string" && fields.path.endsWith(".md"));
  for (const entry of entries) {
    const content = typeof readContent === "function" ? readContent(entry.path) : null;
    if (typeof content !== "string" || content.trim().length === 0) continue;
    const contract = contractForBuildArtifact(entry.path, content);
    if (!contract) continue;
    const result = validateArtifact(content, contract);
    if (!result.pass) {
      out.push({ path: entry.path, label: entry.label ?? entry.path, failures: result.failures.map((failure) => failure.detail).slice(0, 3) });
    }
  }
  return out;
}

/**
 * Validate against a variant contract ({ variants: [...] }): passes when ANY
 * variant passes (single selected native variant per round — never demand
 * both). Failures reported are the closest variant's (fewest failures).
 */
export function validateVariant(text, contract) {
  const variants = Array.isArray(contract?.variants) ? contract.variants : [];
  if (variants.length === 0) return validateArtifact(text, contract);
  let best = null;
  for (const variant of variants) {
    const result = validateArtifact(text, variant);
    if (result.pass) return result;
    if (!best || result.failures.length < best.failures.length) best = result;
  }
  return best ?? { pass: true, failures: [] };
}
