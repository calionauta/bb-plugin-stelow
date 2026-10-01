export type ScopedEntry = {
  id?: string | null;
  name?: string | null;
  conditions?: Array<{ type?: string; reason?: string; message?: string }> | null;
};

/** One condition type, and every scope it applies to. */
export type ConditionGroup = {
  type: string;
  reason: string;
  /** Wording from the first scope carrying this type. */
  message: string;
  /** Scope names, in the order the caller listed the scopes. */
  scopes: string[];
  scopeIds: string[];
};

/**
 * Group conditions across scopes by their `type`.
 *
 * Order follows first appearance, so the card reads in observation order and
 * scopes keep the caller's dependency order.
 */
export declare function groupConditionsByType(entries: ScopedEntry[]): ConditionGroup[];

/** How many scopes a condition type applies to. */
export declare function conditionSpread(group: ConditionGroup): number;

/** True when one condition type applies to more than one scope. */
export declare function isSharedCondition(group: ConditionGroup): boolean;
