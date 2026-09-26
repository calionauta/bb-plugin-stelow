import { useEffect, useRef, useState } from "react";
import { Markdown } from "@get-bb/plugin-sdk/app";
import { optionSectionExcerpt, sectionHeadingsMatch } from "../../lib/option-anchor.mjs";

/** The headings the host's renderer produced, in document order. */
function renderedHeadings(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"));
}

/**
 * Take the reader to the option they clicked, inside the document itself.
 *
 * A combined brief holds every proposal in one file, so opening it at the top
 * shows exactly the options the reader did not pick — the hybrid is last, and
 * the reader clicked the hybrid. The rendered headings carry no ids, but the
 * host DID render them as heading elements inside a scroll container this
 * component owns, so the right section is one `scrollIntoView` away. That
 * keeps the brief reading as one document instead of a quotation above a copy.
 *
 * The comparison is the same pure function the text scan uses, not a copy of
 * its rule: a second, looser match here is how a scroll starts disagreeing
 * with the anchor it is supposed to follow, and it could not be tested anyway.
 *
 * When the heading is absent from the rendered DOM — a non-markdown file, a
 * renderer that flattens headings, a partial load — the lifted section is
 * shown instead. Same matcher, so the two can never point at different
 * sections: the reader gets the option either way, and never a wrong one.
 */
export function OptionSection({ content, optionLabel, containerRef }: {
  content: string | null;
  optionLabel: string | undefined;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [needsFallback, setNeedsFallback] = useState(false);

  const section = content !== null && optionLabel
    ? optionSectionExcerpt(content, optionLabel)
    : null;

  useEffect(() => {
    const root = containerRef.current;
    if (!section || !root) return;
    const target = renderedHeadings(root).find((node) => sectionHeadingsMatch(node.textContent, section.heading));
    if (!target) {
      setNeedsFallback(true);
      return;
    }
    setNeedsFallback(false);
    target.scrollIntoView({ block: "start" });
  }, [section?.heading, content, containerRef]);

  if (!section || !needsFallback) return null;
  return (
    <section aria-label={`Your selection: ${optionLabel}`} className="rounded-md border-2 border-primary/50 bg-primary/5 p-3">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">
        Your selection · {optionLabel}
      </p>
      <div className="text-sm leading-relaxed">
        <Markdown content={`${section.heading}\n\n${section.body}`} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        From {section.heading} in this document (line {section.line}). The full document is below.
      </p>
    </section>
  );
}
