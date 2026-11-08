export declare function recordShapeVersion(
  stateText: unknown,
  shapeVersion: unknown,
): { text: string; changed: boolean; written: boolean };
export declare function readShapeVersion(stateText: unknown): string | null;
