import type { InboxNotification } from "./inbox-panel";

// The item's two reversible acts, in the words of the thing they touch.
//
// There are two because read and handled are different facts. A read question
// that has not been answered still needs an answer, so it stays in Needs
// attention — which is correct, and which is exactly why a single "Mark as
// read" button read as broken: it promised to deal with the item and could not,
// because the item genuinely still needs action. Renaming "Archive" to "Mark as
// read" had collapsed two different decisions into one button.
//
// So both are back, reversible, and named for the update rather than the card:
// "Mark as read" says you have seen it and says plainly that it stays, and
// "Set aside" is the dismissal the reader actually wanted. The one-way
// archive remains the escape behind Set aside's counterpart.
export function ItemActions({ entry, action, onMarkRead, onMarkUnread, onSetAside, onBringBack }: {
  entry: InboxNotification;
  action: "archive" | "restore";
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onSetAside: () => void;
  onBringBack: () => void;
}) {
  const itemActionClass =
    "cursor-pointer min-h-11 shrink-0 rounded-md px-2 text-xs font-medium text-muted-foreground "
    + "hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";
  const read = action === "restore";
  return (
    <>
      <button
        onClick={read ? onMarkUnread : onMarkRead}
        title={read
          ? "You have read this — mark it unread so it asks you again"
          : "You have seen this. It stays here because it still needs you, and moves to the Read filter."}
        className={itemActionClass}
      >
        {read ? "Show again" : "Mark as read"}
      </button>
      {entry.archivedAt ? null : (
        <button onClick={onSetAside} title="Take this out of your Inbox. The card is not affected." className={itemActionClass}>
          Set aside
        </button>
      )}
      {entry.archivedAt ? (
        <button onClick={onBringBack} title="Bring this back where you will see it again" className={itemActionClass}>
          Bring back
        </button>
      ) : null}
    </>
  );
}
