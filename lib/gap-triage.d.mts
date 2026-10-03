export interface GapTriageItem {
  id: string;
  name: string;
  text: string;
}

export function gapsToTriageBatch(
  gaps?: Array<{ id?: string; description?: string } | null> | null,
): {
  items: GapTriageItem[];
  questions: Record<string, { type: string; instructions: string; criteria: string[] }>;
};

export declare const GAP_TRIAGE_CRITIQUE_CHARS: number;

export function buildGapTriageState(options?: {
  critiqueText?: string | null;
  diff?: string | null;
}): string;
