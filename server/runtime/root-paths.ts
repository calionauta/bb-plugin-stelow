/**
 * Root-relative path and file reads shared by every workspace-facing slice.
 *
 * The host exposes files under a workspace root, so almost every runtime read
 * is "root + a relative artifact path". `join` is the single normalizer for
 * that shape (it never lets a leading or trailing slash produce a doubled
 * separator) and `readJson` is the single tolerant reader — a missing or
 * malformed file reads as null instead of throwing into a caller that
 * already has a refusal to report.
 */
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import type { LooseRecord } from "./values.js";
import { record } from "./values.js";

type FilesApi = BbPluginApi["sdk"]["files"];

/** Join a workspace root with a root-relative path, never doubling separators. */
export function join(root: string, relative: string): string {
  return `${root.replace(/\/$/, "")}/${relative.replace(/^\//, "")}`;
}

/** Read and parse a JSON file through the host; unreadable reads as null. */
export async function readJson(
  files: FilesApi,
  path: string,
): Promise<LooseRecord | null> {
  try {
    const file = await files.read({ path });
    return record(JSON.parse(file.content));
  } catch {
    return null;
  }
}

/** The default source path of a bb project, or null when it has none. */
export async function projectRoot(
  bb: BbPluginApi,
  projectId: string | null,
): Promise<string | null> {
  if (!projectId) return null;
  try {
    const project = await bb.sdk.projects.get({ projectId });
    const source =
      project.sources.find((entry) => entry.isDefault) ?? project.sources[0];
    return source?.path ?? null;
  } catch {
    return null;
  }
}

/**
 * An ISO stamp for a listed file, falling back to a caller-supplied string
 * when the host does not report a usable modification time. Card surfaces
 * show "updated" as a moment, so an absent stamp must degrade to something
 * readable rather than to `Invalid Date`.
 */
export function fileTimestamp(
  file: { modifiedAtMs?: unknown } | null,
  fallback: string,
): string {
  const modifiedAtMs = file?.modifiedAtMs;
  return typeof modifiedAtMs === "number" &&
    Number.isFinite(modifiedAtMs) &&
    modifiedAtMs > 0
    ? new Date(modifiedAtMs).toISOString()
    : fallback;
}
