/** A screen or surface in the matrix. */
export interface ContrastPlace {
  /** Stable id the cells address. No `|`, `+` or `*`. */
  id: string;
  /** Affordance ids available here; at least one. Same reserved characters apply. */
  affordances: string[];
}
/**
 * Places crossed with states. An absent cell key and an empty array are the
 * same fact: this cell is blank.
 */
export interface ContrastModel {
  places: ContrastPlace[];
  /** States a place can be in. */
  states: string[];
  /** Keyed `place|state`; the values are affordance ids the place declares. */
  cells: Record<string, string[]>;
}
export type ContrastQuestionKind = "empty-cell" | "dead-state" | "shared-affordance";
export type ReversalCostLevel = "low" | "medium" | "high";
export interface ContrastQuestionOption {
  id: string;
  /** The decision this option takes. Never a question of its own. */
  label: string;
}
/** A question the matrix implies, with the premise that makes it checkable. */
export interface ContrastQuestion {
  /** Derived from the coordinates: `contrast:cart|paid`, `contrast:*|paid`, `contrast:pay-button`. */
  id: string;
  kind: ContrastQuestionKind;
  prompt: string;
  /** `place|state` or `place|state|affordance`, joined by `+` when derived from several cells. */
  premise: string;
  options: ContrastQuestionOption[];
  reversal_cost: { level: ReversalCostLevel; why: string };
}
export declare function assertQuestionFloor(question: ContrastQuestion): ContrastQuestion;
export declare function deriveQuestions(model: ContrastModel): ContrastQuestion[];
