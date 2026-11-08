export declare function canApplyPresetSelection(
  selected: string | null,
  customValue: { providerId: string; modelId: string } | null | undefined,
): boolean;

export declare function presetProviderGroups<
  Provider extends { id: string },
  Model extends { providerId: string },
>(
  catalog: { providers: Provider[]; models: Model[] } | null | undefined,
): Array<{ provider: Provider; models: Model[] }>;
