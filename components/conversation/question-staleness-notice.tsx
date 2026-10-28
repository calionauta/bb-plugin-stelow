import { DisclosureChevron, SUMMARY_LINK } from "../disclosure";
import type { QuestionStalenessNotice } from "./batch-types";

/**
 * The staleness advisory on a question.
 *
 * Advisory only: it names what moved since the question was asked — a revised or
 * removed document, a moved checkout with the touched paths — and points at the
 * existing exits (re-open the doc, request changes, regress the stage). It never
 * blocks answering and adds no new actions of its own.
 *
 * The file paths are what made this unusable: on a real card the notice listed
 * seven paths and pushed the actual question off the screen. The reader needs
 * the WARNING first and the paths only if they are auditing which files moved,
 * so the paths collapse behind a summary that still shows the count. "What this
 * means" is stated before "what changed", because the first thing a person has
 * to decide is whether it matters.
 *
 * Cut out of `question-batch.tsx` when that file reached its line budget. One
 * class for both disclosures (preview and touched paths) so a keyboard focus
 * ring reads identically wherever one appears.
 */
/** The advisory's frame: amber, because it asks the reader to look before deciding. */
const NOTICE_CLASS =
  "rounded-md border border-amber-600/40 bg-amber-600/10 p-2 text-[13px] "
  + "leading-relaxed text-amber-900 dark:text-amber-200";

/** Where the reader goes when the plan and the code have parted. */
const NOTICE_EXIT =
  "If the plan no longer matches the code, request changes or return it to an "
  + "earlier stage from Workflow progress.";

export function StalenessNotice({ staleness }: { staleness: QuestionStalenessNotice }) {
  if (!staleness.docRevised && !staleness.docRemoved && !staleness.checkoutMoved) return null;
  const paths = staleness.touchedPaths;
  return (
    <div
      role="note"
      aria-label="Evidence changed since asked"
      className={NOTICE_CLASS}
    >
      <p className="font-semibold">Something changed since this question was asked</p>
      <p className="mt-1">
        {staleness.docRemoved
          ? "A document this question relies on can no longer be opened."
          : staleness.docRevised
            ? "A document this question relies on was revised."
            : `${staleness.commitCount} commit${staleness.commitCount === 1 ? "" : "s"} landed.`}
        {" "}Check the linked document before answering if your choice depends on it.
      </p>
      {/* `group` is load-bearing: the chevron rotates from the `group-open:` variant when
          it is not given an explicit `open`, so a <details> without it renders a
          disclosure whose arrow never moves. This one was missing it. */}
      {paths.length > 0 ? (
        <details className="group mt-1">
          <summary className={SUMMARY_LINK}>
            <DisclosureChevron />
            {paths.length} file{paths.length === 1 ? "" : "s"} touched
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 font-mono text-xs">
            {paths.map((path) => <li key={path} className="break-all">{path}</li>)}
          </ul>
        </details>
      ) : null}
      <p className="mt-1 text-amber-900/70 dark:text-amber-200/70">{NOTICE_EXIT}</p>
    </div>
  );
}
