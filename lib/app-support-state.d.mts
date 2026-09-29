export function activeCardCount<T extends { kind?: string | null; status: string; stage?: string | null; workerThreadId?: string | null }>(cards: T[]): number;
export function accessoryTone(count: number, activeTone: string): string;
