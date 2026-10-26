export type OrderState = { viewKey: string; frozen: readonly string[] };

export declare function nextOrderState(
  previous: OrderState | null | undefined,
  naturalIds: readonly string[],
  viewKey: string,
): OrderState;

export declare function showRequested(
  state: OrderState,
  naturalIds: readonly string[],
): OrderState;
