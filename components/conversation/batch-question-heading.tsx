import { questionCopy } from "../../lib/question-presentation.mjs";
import { Button } from "../ui/button";
import { BoundaryQuestionFrame } from "./boundary-question-frame";
import { StalenessNotice } from "./question-staleness-notice";
import type { BatchItem } from "./batch-types";

/**
 * The question's heading: the step dots, its title, its prompt, and the two
 * advisories (staleness, split exclusivity) that travel with it.
 *
 * Cut out of `question-batch.tsx` when the keyboard layer moved in: that file
 * was at its line budget and a surface with a runner, a pair of door handles
 * and two paragraphs of placement reasoning is a good place to stop adding.
 */

const DOT_TONE = "border-border bg-background/40 text-muted-foreground";

/**
 * The step dots: one per question, the current one marked, done ones checked.
 *
 * The shared `Button` rather than a raw element — it already carries the touch
 * height and the pointer cursor, and this repo's rule is that a shared name is
 * imported rather than re-spelled. That also keeps these out of the raw-button
 * census, which counts elements rather than asking whether they are styled.
 */
export function BatchStepDots({ questions, index, onSelect, isDone, copy }: {
  questions: BatchItem[];
  index: number;
  onSelect: (index: number) => void;
  isDone: (id: string) => boolean;
  copy: ReturnType<typeof questionCopy>;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={copy.questions}>
      {questions.map((q, i) => {
        const done = isDone(q.id);
        const tone = i === index
          ? "border-primary bg-primary/15 text-foreground"
          : done
            ? "border-emerald-500/50 bg-emerald-500/10 text-foreground"
            : DOT_TONE;
        return (
          <Button
            key={q.id}
            variant="outline"
            size="sm"
            aria-current={i === index ? "step" : undefined}
            aria-label={`${copy.questionOf(i + 1, questions.length)}${done ? ` (${copy.answered})` : ""}`}
            onClick={() => onSelect(i)}
            className={`min-h-11 min-w-11 cursor-pointer ${tone}`}
          >
            {done && i !== index ? "✓ " : ""}{i + 1}
          </Button>
        );
      })}
    </div>
  );
}

/**
 * The heading itself.
 *
 * The counters went (2026-10-18) with the panel frame. It used to open with
 * "2 questions need your answer" and "Question 1 of 2" — both of which the hero
 * already says in its state line and the dots already show as numerals. Three
 * statements of one fact, two lines apart, is why nothing on the panel read as
 * the primary action. The dots keep their position in the batch for assistive
 * tech: their aria-label still reads "Question i of N (answered)", so removing
 * the visible counter costs a screen-reader user nothing.
 */
export function BatchQuestionHeading({ questions, index, copy, current, prompt, onSelectDot, isDone }: {
  questions: BatchItem[];
  index: number;
  copy: ReturnType<typeof questionCopy>;
  current: BatchItem;
  prompt: string;
  onSelectDot: (index: number) => void;
  isDone: (id: string) => boolean;
}) {
  return (
    <>
      {questions.length > 1 ? (
        <BatchStepDots questions={questions} index={index} onSelect={onSelectDot} isDone={isDone} copy={copy} />
      ) : null}
      {current.title ? <div className="text-sm font-medium text-foreground">{current.title}</div> : null}
      {current.boundary ? <BoundaryQuestionFrame boundary={current.boundary} /> : null}
      {prompt ? <p className="text-sm leading-relaxed text-muted-foreground">{prompt}</p> : null}
      {current.staleness ? <StalenessNotice staleness={current.staleness} /> : null}
    </>
  );
}
