/**
 * Deterministic depth validation over markdown artifacts. Pure functions
 * interpreting the check DSL from lib/artifact-contracts.mjs — no I/O,
 * no model judgment. validateArtifact returns { pass, failures[] } where
 * each failure is { code, expected, found, detail } with a human-readable
 * expected-vs-found line for verify/done/inbox rendering.
 */
import { contractForSubstep } from "./artifact-contracts.mjs";

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
    let failure = null;
    if (check.kind === "headings") failure = checkHeadings(body, check);
    else if (check.kind === "named-headings") failure = checkNamedHeadings(body, check);
    else if (check.kind === "contains") failure = checkContains(body, check);
    else if (check.kind === "section-items") failure = checkSectionItems(body, check);
    else if (check.kind === "field-blocks") failure = checkFieldBlocks(body, check);
    else if (check.kind === "table-rows") failure = checkTableRows(body, check);
    if (failure) failures.push(failure);
  }
  return { pass: failures.length === 0, failures };
}

/** Validate a composite substep slug's content; unknown slugs pass (unmigrated). */
export function validateSubstep(slug, content) {
  return validateArtifact(content, contractForSubstep(slug));
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
