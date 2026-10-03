export declare const MAX_REWORK_ROUNDS: number;

export declare function reworkRoundsOf(entry: unknown): number;

export declare function reworkCapReached(entry: unknown): boolean;

export declare function nextReworkRounds(entry: unknown, createdCount: number): number;

export declare function reworkCapRefusal(rounds: number, unscoped: unknown): string;
