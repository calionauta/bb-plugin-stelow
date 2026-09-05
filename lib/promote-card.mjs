/**
 * Promote decisions for turning exploratory work into a real BB project.
 * Pure (no BB SDK): the RPC handler owns SDK calls, this module owns the
 * naming and adoption rules so they are unit-testable.
 */

/**
 * Resolve the project name for a promote. Falls back to the card's display
 * name so an empty input still has a valid exit instead of a dead refusal.
 */
export function normalizePromoteName(raw, fallback) {
  const candidate = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ").slice(0, 120) : "";
  if (candidate) return candidate;
  const backup = typeof fallback === "string" ? fallback.trim().replace(/\s+/g, " ").slice(0, 120) : "";
  return backup || "Exploratory work";
}

/**
 * Decide what to do about a requested project name given the existing
 * projects. Returns one of:
 * - { action: "create" } — name is free, create a fresh project.
 * - { action: "adopt", project: entry } — a project with the same name
 *   already points at this exact workspace path (partial retry after the
 *   project was created but the card update failed): adopt it instead of
 *   erroring on the duplicate name.
 * - { action: "conflict", project: entry } — name is taken by an unrelated
 *   project: the user must pick another name.
 */
export function findAdoptableProject(projects, name, workspacePath) {
  const wanted = name.trim().toLowerCase();
  const match = (Array.isArray(projects) ? projects : []).find(
    (entry) => entry && typeof entry.name === "string" && entry.name.trim().toLowerCase() === wanted,
  );
  if (!match) return { action: "create" };
  const sources = Array.isArray(match.sources) ? match.sources : [];
  const samePath = sources.some((source) => source && source.path === workspacePath);
  if (samePath) return { action: "adopt", project: match };
  return { action: "conflict", project: match };
}
