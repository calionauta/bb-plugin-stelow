import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { codeOf } from "./source-code.mjs";

/**
 * Find class groups that clamp a line and reset its display at the same time.
 *
 * `line-clamp-2` works by declaring `display: -webkit-box`, and the utility
 * compiles into the same `@layer utilities` as `.block{display:block}` at the
 * same (0,1,0) specificity — so source order decides. In the Inbox row the two
 * sat side by side, `.block` comes after `.line-clamp-2` in the built
 * stylesheet, and the two-line cap that the row documented for itself had never
 * applied at any width. (The relationship is stable; the byte offsets that prove
 * it today are not, so this comment states the order and not a number.) On a phone that was half of the reported
 * "row occupies the whole screen vertically".
 *
 * So the rule is: a class group may declare a `line-clamp-*` token or a `block`
 * token, never both. This helper is the scan; `tests/card-design-tokens.test.mjs`
 * owns the assertion, because that file already reads `components/` as text and
 * the repository's pin ratchet counts every test file that does.
 *
 * It reads JSX `className` values (quoted, concatenated, or template literals)
 * and class-name constants, because a shared class string is exactly where this
 * pattern would hide next. What it cannot see: a `block` that arrives from a
 * different class group, or a literal assembled at runtime.
 */

/** Every JSX className value and class-name constant, as raw expression text. */
export function classGroups(source) {
  const groups = [];

  for (let index = source.indexOf("className="); index !== -1; index = source.indexOf("className=", index + 1)) {
    const cursor = index + "className=".length;
    if (source[cursor] === '"' || source[cursor] === "'") {
      const quote = source[cursor];
      const end = source.indexOf(quote, cursor + 1);
      if (end === -1) continue;
      groups.push(source.slice(cursor + 1, end));
      continue;
    }
    if (source[cursor] !== "{") continue;
    let depth = 0;
    for (let scan = cursor; scan < source.length; scan += 1) {
      if (source[scan] === "{") depth += 1;
      else if (source[scan] === "}") {
        depth -= 1;
        if (depth === 0) {
          groups.push(source.slice(cursor + 1, scan));
          break;
        }
      }
    }
  }

  for (const match of source.matchAll(/const\s+\w*[Cc]lass\w*\s*=\s*([\s\S]*?);\n/g)) {
    groups.push(match[1]);
  }

  return groups;
}

/** Class tokens inside one group, quotes and concatenation removed. */
export function tokensOf(group) {
  return group
    .split(/["'`]/)
    .join(" ")
    .split(/[+\n]/)
    .join(" ")
    .split(/\s+/)
    .filter(Boolean);
}

function sources(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      found.push(...sources(full));
      continue;
    }
    if (/\.(tsx?|mts)$/.test(name)) found.push(full);
  }
  return found;
}

/**
 * Scan `components/` and `lib/` (the roots the type-size census uses) under
 * `root`, and return both what was found and what is wrong.
 */
export function scanForClampDisplayConflicts(root) {
  const clamped = new Set();
  const offenders = [];

  for (const file of [...sources(join(root, "components")), ...sources(join(root, "lib"))]) {
    const relative = file.slice(root.length);
    for (const group of classGroups(codeOf(readFileSync(file, "utf8")))) {
      const tokens = tokensOf(group);
      const hasClamp = tokens.some((token) => /(?:^|:)line-clamp-\d+$/.test(token));
      if (!hasClamp) continue;
      clamped.add(relative);
      if (tokens.some((token) => /(?:^|:)block$/.test(token))) {
        offenders.push(`${relative} → ${tokens.join(" ")}`);
      }
    }
  }

  return { clamped, offenders };
}
