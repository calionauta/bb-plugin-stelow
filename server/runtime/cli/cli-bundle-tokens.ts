import { sumTokenBreakdowns, tokenBreakdownFromEvents, usageFromEvents } from "../../../lib/token-usage.mjs";
import type { CliDeps } from "./cli-deps.js";
import type { WorkerCard } from "../../workers-types.js";

/**
 * Token evidence for a run bundle, with the provenance of every figure it prints.
 *
 * Extracted from the bundle writer, which owns formatting a bundle rather than
 * reading usage, and because that file was over the repository's 400-line budget.
 *
 * The provenance is the reason this is more than a sum. Only one of four providers
 * reports a token total; the rest report a context-window reading, so most cards
 * carry estimates. The manifest states which kind of figure it is printing, and a sum
 * of measurements and estimates is not itself a measurement — so the weakest
 * provenance among the parts is the one the whole carries.
 */

/** Token evidence joins the bundle: provider-reported splits across the card's
 * threads, summed once, committed with the run. Bounded (20 latest threads)
 * and fail-open — export never blocks on it. */
/** One thread's token reading, with its provenance, or null when it reported none. */
async function threadTokenReading(deps: CliDeps, threadId: string) {
  try {
    // Both families, and one query each. Asking only for the token family left most
    // cards reporting nothing: only one of four providers sends a token total and the
    // rest send a context-window reading. Asking per family keeps each family's newest
    // event on its own page, which a combined small page does not guarantee — the two
    // interleave and the newest two events on an ACP thread are usually both context.
    const [tokenEvents, contextEvents] = await Promise.all([
      deps.bb.sdk.threads.events.list({
        threadId, types: ["thread/tokenUsage/updated"], order: "desc", limit: "1",
      }),
      deps.bb.sdk.threads.events.list({
        threadId, types: ["thread/contextWindowUsage/updated"], order: "desc", limit: "1",
      }),
    ]);
    const reading = usageFromEvents([...tokenEvents, ...contextEvents]);
    // The provenance travels with the number, because the manifest states which kind
    // of figure it is printing.
    const breakdown = tokenBreakdownFromEvents(tokenEvents);
    if (breakdown) return { ...breakdown, source: reading.source };
    if (reading.total === null) return null;
    // A context reading has no input/output split, so the legs stay null rather than
    // being fabricated from a single number.
    return {
      total: reading.total, input: null, output: null, cached: null, reasoning: null,
      source: reading.source,
    };
  } catch {
    return null;
  }
}

/** Token evidence for the bundle: every thread's reading, summed, with the weakest
 * provenance among the parts — a sum of measurements and estimates is not a
 * measurement, and the manifest's wording depends on which it is. */
export async function bundleTokenEvidence(deps: CliDeps, card: WorkerCard) {
  try {
    const threadIds = deps.workers.ledgerThreadIds(card.id, 20);
    const reported = await Promise.all(threadIds.map((threadId) => threadTokenReading(deps, threadId)));
    const summed = sumTokenBreakdowns(reported);
    if (!summed) return null;
    const sources = reported.filter((r): r is NonNullable<typeof r> => Boolean(r)).map((r) => r.source);
    const everyProvider = sources.length > 0 && sources.every((source) => source === "provider");
    const anyEstimate = sources.includes("context-estimate");
    return { ...summed, source: everyProvider ? "provider" : anyEstimate ? "context-estimate" : null };
  } catch {
    return null;
  }
}
