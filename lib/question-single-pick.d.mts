export function toggleSinglePick(selected: readonly string[] | null | undefined, label: string): string[];
export function pickedLabels(answers: readonly unknown[] | null | undefined, optionLabels: readonly unknown[] | null | undefined): string[];
export interface ExclusivePickInput { question?: unknown; multiple?: unknown; answers?: unknown; optionLabels?: unknown }
export function exclusivePickRefusal(input: ExclusivePickInput): string | null;
