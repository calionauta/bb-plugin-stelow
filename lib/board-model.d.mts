export interface BoardBand {
  /** Stable id the places and the record refer to. */
  id: string;
  /** Phase name a reader sees; defaults to the id. */
  label?: string;
}

export interface BoardAffordance {
  id: string;
  /** What the reader can do here; defaults to the id. */
  label?: string;
}

export interface BoardPlace {
  id: string;
  /** Id of the band this screen belongs to. */
  band: string;
  label?: string;
  /** Things a reader can do in this place; may be empty. */
  affordances: BoardAffordance[];
}

export interface BoardEdge {
  /** Place the move starts at, and the place it ends at. */
  from: string;
  to: string;
  label?: string;
}

export interface BoardQuestion {
  id: string;
  /** Place that raised the question. */
  place: string;
  label?: string;
}

/** The whole board: four collections, and nothing else. */
export interface BoardModel {
  bands: BoardBand[];
  places: BoardPlace[];
  edges: BoardEdge[];
  questions: BoardQuestion[];
}

export declare function assertBoardModel(model: unknown): asserts model is BoardModel;
