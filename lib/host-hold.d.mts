export type HostHoldKind = "capacity" | "offline" | "permission" | "scheduled" | "queued";

export type HostHold = {
  kind: HostHoldKind;
  /** The holder's identity — a plugin id or a host name. Null for a permission
   * request, which belongs to no holder and is answered in the thread. */
  holderId: string | null;
  /** The host's own words, verbatim. Null when the host gave none. */
  reason: string | null;
  /** How many messages are held behind this one. */
  queued: number;
};

export declare const HELD_ACTIVITY: "held";

export declare function hostHold(rows: unknown): HostHold | null;

export declare function holdSentence(hold: HostHold | null): string | null;

export declare function holdUpdates(lastOutput: string | null): {
  activity: "held";
  last_assistant_text: string | null;
};
