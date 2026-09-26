/** The three coercions the runtime and the CLI share when reading
 * `state.md`, `stelow.json`, and other worker-written JSON. They exist so a
 * malformed value narrows to a safe default instead of throwing at the read
 * site — one owner, one behavior, imported by both layers. */

export type LooseRecord = Record<string, unknown>;

export function record(value: unknown): LooseRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as LooseRecord)
    : {};
}

export function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
