export declare const EXPLORE_TRACK_CONFIG: { kind: string; band: string };
export declare const RESEARCH_TRACK_CONFIG: { kind: string; band: string };
export declare function trackCardListRequest<K extends string>(
  kind: K,
  projectId: string | null,
): { projectId: string | null; kind: K };
export declare function trackCardMatches(
  card: { projectId?: unknown; needsAttention?: unknown },
  filters: { projectIds: string[]; attention: boolean },
): boolean;
export declare function filterAndGroupTrackCards<T>(
  cards: T[],
  filters: { columns: string[]; projectIds: string[]; attention: boolean },
): Record<string, T[]>;
export declare function trackLabelsById(items: Array<{ id: string; label: string }>): Map<string, string>;
export declare function trackPresetFor<P extends { id: string }, A extends { band: string }>(
  presets: P[],
  assignments: A[],
  band: string,
): { preset: P | null; hasBandPreset: boolean };
