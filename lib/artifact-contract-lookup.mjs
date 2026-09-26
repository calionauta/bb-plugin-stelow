/**
 * Shared id lookup for the contract slices (lib/jtbd-contracts.mjs,
 * lib/strategy-contracts.mjs, lib/explore-contracts.mjs). A missing id is
 * "not migrated yet", never a throw: an unmigrated artifact must not block
 * completion, it must simply have no contract to validate against.
 */
export function findByKey(list, key, value) {
  if (typeof value !== "string" || !value) return null;
  return list.find((entry) => entry[key] === value) ?? null;
}
