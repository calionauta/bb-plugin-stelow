export type DependencyState = "satisfied" | "running" | "waiting" | "missing";
export type DependencyKind = "depends-on" | "blocked-by";

export type DependencyRow = {
  /** The scope that waits. */
  from: string | null;
  /** The scope waited on, or null when it is not on the card. */
  to: string | null;
  kind: DependencyKind;
  state: DependencyState;
  /** The whole relation as a sentence, with the state as a word. */
  text: string;
  label: string;
  tone: "muted" | "active" | "warn";
  glyph: string;
};

/** One dependency row, with its state derived from the target's status. */
export declare function dependencyRow(input: {
  from?: string | null;
  to?: string | null;
  kind?: DependencyKind;
  targetStatus?: string | null;
}): DependencyRow;

/** A scope's dependencies as rows: ordering edges, then blocks. */
export declare function dependencyRows(input: {
  from?: string | null;
  dependsOn?: string[] | null;
  blockedBy?: string[] | null;
  scopeById?: Map<string, { status?: string | null } | null | undefined>;
}): DependencyRow[];

/** Rows that name a target this card does not have. */
export declare function missingDependencyRows(rows: DependencyRow[]): DependencyRow[];
