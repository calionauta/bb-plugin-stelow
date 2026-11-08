export declare function stableInboxOrder(
  previous: readonly string[] | null | undefined,
  entries: readonly { id: string }[] | null | undefined,
): { order: string[]; held: number };
