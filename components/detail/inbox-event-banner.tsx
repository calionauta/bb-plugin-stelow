import { useEffect, useRef } from "react";
import { inboxEventDescription, inboxEventPresentation, inboxEventTime } from "../../lib/inbox-event-presentation.mjs";

// Inbox-event banner shared by the detail bodies: one definition instead
// of a drifting copy. Renders the event's presentation (label, tone,
// description, time) and focuses it on arrival.

// Structural view of an inbox event: the banner only reads identity,
// presentation, and timing — never the card behind it.
export type InboxEventItem = {
  kind: "question" | "error" | "paused" | "completed";
  summary: string;
  occurredAt: number;
  resolvedAt: number | null;
  archivedAt: number | null;
};

export function InboxEventBanner({ visible, event, sectionRef }: {
  visible: boolean;
  event: InboxEventItem | null;
  sectionRef: React.RefObject<HTMLElement | null>;
}) {
  if (!visible) return null;
  const presentation = event ? inboxEventPresentation(event) : null;
  return (
    <section ref={sectionRef} tabIndex={-1} className={`rounded-lg border p-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${presentation?.tone ? "border-border bg-muted/40" : "border-amber-500/40 bg-amber-500/10"}`} aria-label="Inbox notification">
      <p className="text-sm font-semibold">{presentation ? `${presentation.label}.` : "Opened from Stelow Inbox."}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{event ? inboxEventDescription(event) : "This notification is no longer available."}</p>
      {event && presentation ? <p className="mt-1 text-xs text-muted-foreground" title={new Date(presentation.stateAt).toLocaleString()}>{inboxEventTime(event)}</p> : null}
    </section>
  );
}

export function useInboxEventFocus(eventId: string | null, event: InboxEventItem | null, sectionRef: React.RefObject<HTMLElement | null>) {
  const focusedEventId = useRef<string | null>(null);
  useEffect(() => {
    if (!eventId || !event || focusedEventId.current === eventId) return;
    focusedEventId.current = eventId;
    sectionRef.current?.scrollIntoView({ block: "nearest" });
    sectionRef.current?.focus({ preventScroll: true });
  }, [event, eventId, sectionRef]);
}
