import { frozenBadgeFor, isFrozenStale } from "./frozen-acceptance-row.mjs";
import { TEXT_META } from "../../lib/design-tokens";

/**
 * Frozen technical acceptance row (read-only mirror).
 *
 * A different fact from the human receipt (`acceptance-row.tsx`, backed by
 * the human-receipt lib module): this row mirrors the frozen technical
 * acceptance for a scope — its test_map entries, each pinned by freeze_sha
 * and proven by red_proof — and never offers an "Accept" action. Human
 * disposition is written by a person; a freeze is written by the verify
 * pipeline. One row per fact, so a reader can never mistake a lock for a
 * receipt.
 *
 * Renders nothing when there is no frozen technical acceptance to mirror:
 * an absent freeze is an absent fact, never a warning.
 */

export type FrozenTestMapEntry = {
  test: string;
  frozen?: boolean | null;
  redProof?: string | null;
  freezeSha?: string | null;
};

const BADGE_TONE_CLASS: Record<string, string> = {
  red: "bg-red-500/15 text-red-700 dark:text-red-300",
  green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  missing: "bg-muted text-muted-foreground",
};

function FrozenStaleBanner({ freezeSha, currentHeadSha }: {
  freezeSha?: string | null;
  currentHeadSha?: string | null;
}) {
  return (
    <p
      className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs leading-relaxed text-amber-900 dark:text-amber-200"
      role="note"
      title={`frozen-stale: freeze_sha ${freezeSha} ≠ current ${currentHeadSha}`}
    >
      frozen-stale: the checkout moved since this acceptance froze
      ({String(freezeSha).slice(0, 7)} → {String(currentHeadSha).slice(0, 7)}).
      Re-run verify to re-freeze — the badges above describe the old tree.
    </p>
  );
}

export function FrozenAcceptanceRow({ entries, freezeSha, currentHeadSha }: {
  entries: FrozenTestMapEntry[] | null | undefined;
  freezeSha?: string | null;
  currentHeadSha?: string | null;
}) {
  const list = Array.isArray(entries) ? entries : [];
  // test_map drives the badges: one badge per mapped criterion.
  const test_map = list.filter((entry) => entry && typeof entry.test === "string" && entry.test.trim());
  if (test_map.length === 0) return null;
  const stale = isFrozenStale({ freezeSha, currentHeadSha });
  return (
    <div className="mt-3 space-y-1.5 border-t pt-3">
      <p className={TEXT_META}>
        Frozen acceptance ({test_map.length} test_map {test_map.length === 1 ? "criterion" : "criteria"})
        {" · "}freeze_sha {freezeSha ? freezeSha.slice(0, 7) : "unpinned"}
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {test_map.map((entry) => {
          const badge = frozenBadgeFor({
            test: entry.test,
            frozen: entry.frozen ?? (freezeSha ? true : false),
            redProof: entry.redProof ?? null,
          });
          // red_proof decides red vs green; the lock marks the frozen state
          // so colour is never the only signal.
          return (
            <li
              key={entry.test}
              title={entry.redProof ? `red_proof: ${entry.redProof}` : "no red_proof recorded"}
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_TONE_CLASS[badge.tone] ?? BADGE_TONE_CLASS.missing}`}
            >
              <span aria-hidden>{badge.glyph} </span>
              {badge.label}
            </li>
          );
        })}
      </ul>
      {stale ? <FrozenStaleBanner freezeSha={freezeSha} currentHeadSha={currentHeadSha} /> : null}
    </div>
  );
}
