export declare const ARCHETYPE_PHILOSOPHY: Record<string, string>;
export declare const EXPLORATION_ARCHETYPES: Array<{
  count: string;
  archetypes: string[];
  hybrid: boolean;
  note: string;
}>;
export declare function archetypesForCount(count: unknown): { archetypes: string[]; hybrid: boolean };
