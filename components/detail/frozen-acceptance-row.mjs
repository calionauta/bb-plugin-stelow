/**
 * Frozen technical acceptance badge mapping (pure, no I/O).
 *
 * Human acceptance (human-receipt lib module) and frozen technical
 * acceptance (test_map / freeze_sha / red_proof) are different facts about
 * the same card. This module owns only the technical side: given one
 * test_map entry, which badge it earns. The row component renders it; the
 * hero places that row beside, never inside, the human receipt.
 *
 * Tones: "red" (frozen + red_proof fail), "green" (frozen + red_proof pass,
 * locked), "missing" (anything else — unfrozen, unmapped, or no entry).
 * A missing entry is not red: an absent freeze is an absent fact, never a
 * failed one.
 */

export function frozenBadgeFor(entry) {
  if (!entry || typeof entry !== "object") return { tone: "missing", glyph: "○", label: "no frozen acceptance" };
  const test = typeof entry.test === "string" ? entry.test.trim() : "";
  if (!test) return { tone: "missing", glyph: "○", label: "unmapped criterion" };
  if (entry.frozen !== true) return { tone: "missing", glyph: "○", label: `unfrozen: ${test}` };
  // red_proof estruturado {failed_command, exit_code, output_excerpt}:
  // exit_code != 0 prova o FAIL (red), exit_code 0 prova o PASS (green+lock).
  const structured = entry.redProof !== null && typeof entry.redProof === "object" && !Array.isArray(entry.redProof)
    ? entry.redProof
    : null;
  if (structured) {
    const code = typeof structured.exit_code === "number"
      ? structured.exit_code
      : typeof structured.exitCode === "number" ? structured.exitCode : null;
    if (code !== null && Number.isInteger(code)) {
      if (code !== 0) return { tone: "red", glyph: "●", label: `red: ${test}` };
      return { tone: "green", glyph: "🔒", label: `frozen 🔒: ${test}` };
    }
  }
  const proof = typeof entry.redProof === "string" ? entry.redProof.trim().toLowerCase() : "";
  if (proof === "fail" || proof === "failed") {
    return { tone: "red", glyph: "●", label: `red: ${test}` };
  }
  if (proof === "pass" || proof === "passed" || proof === "green") {
    return { tone: "green", glyph: "🔒", label: `frozen 🔒: ${test}` };
  }
  return { tone: "missing", glyph: "○", label: `no red_proof: ${test}` };
}

/**
 * Whether the frozen-stale banner applies: the checkout moved since the
 * freeze_sha was recorded. Null/undefined freeze means "no freeze", never
 * "stale" — the row renders nothing instead of warning about a fact it
 * does not hold.
 */
export function isFrozenStale({ freezeSha, currentHeadSha } = {}) {
  if (typeof freezeSha !== "string" || !freezeSha) return false;
  if (typeof currentHeadSha !== "string" || !currentHeadSha) return false;
  return freezeSha !== currentHeadSha;
}
