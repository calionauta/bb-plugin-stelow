/**
 * Whether the Agent preset dialog's Apply action is available for the current
 * choice. `customValue` is the EFFECTIVE value the dialog renders — the raw
 * picker state merged with the board default — so the button asks the same
 * question the form visibly answers. Checking the raw picker state instead
 * disabled Apply on a complete, visible selection: choosing "Custom" showed
 * the default preset's provider and model in the picker while the button
 * stayed dead, with nothing left for the reader to fill in.
 */
export function canApplyPresetSelection(selected, customValue) {
  if (!selected) return false;
  if (selected !== "custom") return true;
  return Boolean(customValue?.providerId && customValue?.modelId?.trim());
}

/**
 * The provider sections the dialog may offer: only providers that actually
 * list a model. A registered provider with an empty catalog — Cursor before
 * sign-in, for example — is not a choice, and showing it as
 * "Cursor · 0 / No models listed for this provider" reads as a configuration
 * the reader forgot to make. The Custom picker still reaches every provider
 * the host knows, including ones whose catalog failed to load.
 */
export function presetProviderGroups(catalog) {
  const providers = Array.isArray(catalog?.providers) ? catalog.providers : [];
  const models = Array.isArray(catalog?.models) ? catalog.models : [];
  return providers
    .map((provider) => ({
      provider,
      models: models.filter((model) => model.providerId === provider.id),
    }))
    .filter((group) => group.models.length > 0);
}
