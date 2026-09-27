/**
 * How a bulk delete of archived cards is reported back.
 *
 * A bulk action that reported only "done" would hide the one card whose native
 * run refused to stop, and the reader would look at an empty column and believe
 * it. So the outcome is per card, and a partial success must READ as partial.
 *
 * Two decisions live here rather than in the component, because both are
 * judgement calls a reader can disagree with:
 *
 * - partial failure is an ERROR tone, not a success with a caveat. A toast that
 *   says "Deleted 40" while 2 remain is the exact lie this shape avoids.
 * - the count is what was DELETED, never what was requested. Reporting the
 *   request would read as success on a run that destroyed nothing.
 *
 * Only the first failure's reason is spelled out; the rest are counted. One
 * reason is actionable, and a wall of repeated text hides it.
 */

export function describeBulkDelete(result, requested) {
  const gone = Array.isArray(result?.deleted) ? result.deleted.length : 0;
  const stuck = Array.isArray(result?.failed) ? result.failed : [];
  const asked = Number.isInteger(requested) && requested > 0 ? requested : gone + stuck.length;
  // Success needs POSITIVE evidence of a deletion. An empty or malformed result
  // is not one: reading it as success would print "Deleted 0 archived cards."
  // in a success tone, which is the same overstatement as claiming the request.
  if (stuck.length === 0 && gone > 0) {
    const noun = asked === 1 ? "card" : "cards";
    return { message: `Deleted ${gone} archived ${noun}.`, tone: "success" };
  }
  if (stuck.length === 0) {
    return { message: "Deleted nothing.", tone: "error" };
  }
  const reason = stuck[0]?.error || "The card was not deleted.";
  const extra = stuck.length > 1 ? ` (+${stuck.length - 1} more)` : "";
  if (gone === 0) {
    return {
      message: `Deleted nothing. ${stuck.length} refused: ${reason}${extra}`,
      tone: "error",
    };
  }
  return {
    message: `Deleted ${gone} of ${asked}. Still there: ${stuck.length} — ${reason}${extra}`,
    tone: "error",
  };
}
