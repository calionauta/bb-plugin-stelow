export declare const TEST_SCRIPT_FLOOR: number;

export declare function testScriptNames(scripts: Record<string, unknown>): string[];

export declare function assertTestScriptFloor(
  scripts: Record<string, unknown>,
  floor?: number,
): { count: number; floor: number };
