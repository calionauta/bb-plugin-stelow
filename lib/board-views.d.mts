export type BoardView = "board" | "list" | "hill";
export type BoardTrack = "build" | "research" | "explore";

export function viewsForTrack(track: BoardTrack): BoardView[];
export function normalizeBoardView(value: unknown, track: BoardTrack): BoardView;
