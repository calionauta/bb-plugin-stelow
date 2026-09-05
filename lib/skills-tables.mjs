/**
 * GFM table validation for vendored skill docs.
 *
 * Workers copy table formats straight out of the skill references, so an
 * invalid delimiter row there (e.g. `:---:+` with a stray `+`, which no GFM
 * renderer recognizes) silently ships broken tables into every generated
 * artifact: the viewer then shows raw pipes instead of a table.
 */

const DELIMITER_CELL = /^:?-+:?$/;

function splitRow(line) {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|")) text = text.slice(0, -1);
  return text.split("|").map((cell) => cell.trim());
}

function isPipeRow(line) {
  return line.trim().startsWith("|") && line.includes("|", 1);
}

/**
 * Scan markdown source for GFM table blocks (outside fenced code) and
 * report blocks whose delimiter row is missing or has invalid cells.
 * Returns [{ line, cells }] with 1-based line numbers into the original text.
 */
export function findInvalidTableDelimiters(text) {
  const live = [];
  let fenced = false;
  text.split("\n").forEach((line, index) => {
    if (line.trim().startsWith("```")) {
      fenced = !fenced;
      return;
    }
    if (!fenced) live.push({ line: index + 1, text: line });
  });
  const problems = [];
  let i = 0;
  while (i < live.length) {
    if (!isPipeRow(live[i].text)) {
      i++;
      continue;
    }
    const start = i;
    while (i < live.length && isPipeRow(live[i].text)) i++;
    const block = live.slice(start, i);
    if (block.length < 2) continue;
    const cells = splitRow(block[1].text);
    const valid = cells.length > 0 && cells.every((cell) => DELIMITER_CELL.test(cell));
    if (!valid) {
      const headerCells = splitRow(block[0].text);
      const looksLikeTable =
        headerCells.length === cells.length &&
        headerCells.length > 1 &&
        !cells.every((cell) => cell === "");
      if (looksLikeTable) problems.push({ line: block[1].line, cells });
    }
  }
  return problems;
}
