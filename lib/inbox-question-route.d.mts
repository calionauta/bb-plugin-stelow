/** The reasons a question row opens the card instead of the narrow door. */
export declare const QUESTION_ROUTE_REFUSALS: {
  "not-a-question": string;
  "no-document-viewer": string;
  "split-creates-cards": string;
};

export type InboxQuestionRoute =
  | { route: "direct"; reason: string }
  | { route: "card"; reason: string; exit: string };

/**
 * Whether an Inbox row's question opens the narrow door, and where a refusal
 * sends the reader instead.
 */
export declare function inboxQuestionRoute(
  event: unknown,
  options?: { hasDocumentViewer?: boolean; hasSplitQuestion?: boolean },
): InboxQuestionRoute;

export declare function isQuestionRouteCandidate(event: unknown): boolean;
