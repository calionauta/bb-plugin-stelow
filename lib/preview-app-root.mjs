/**
 * Where the app actually is, and what it is — the workspace probe behind both
 * `start` and an at-rest `view`. Three effects, injected, so a node test
 * describes a workspace as a set of files and directories instead of a host.
 */
import {
  PREVIEW_CONFIG_REL,
  PREVIEW_PROBE_FILES,
  detectPreview,
  parseDeclaredPreview,
  pickAppDir,
  previewAppDirs,
  previewSnapshot,
} from "./preview-detect.mjs";

/**
 * @param {(path: string) => Promise<string | null>} readFile one file's text, or null
 * @param {(dir: string) => string[]} listDirs             child directory names
 * @param {(...parts: string[]) => string} joinPath         path join for the host running the server
 */
export function createAppRootResolver({ readFile, listDirs, joinPath }) {
  /** Detection for one directory, with that directory's declared override applied. */
  async function detectionAt(dir) {
    const entries = await Promise.all(
      PREVIEW_PROBE_FILES.map(async (rel) => [rel, await readFile(joinPath(dir, rel))]),
    );
    const snapshot = previewSnapshot(new Map(entries.filter((entry) => typeof entry[1] === "string")));
    const declared = snapshot.read(PREVIEW_CONFIG_REL);
    return {
      detection: detectPreview(snapshot, { declared, allowStatic: true }),
      declared: parseDeclaredPreview(declared),
    };
  }

  /**
   * The checkout root first; when nothing there is a web app, exactly one level
   * down — agents routinely put the deliverable in a subdirectory named after
   * the work, and a root-only search would answer "nothing to preview" for a
   * finished product. A self-contained `index.html` counts: it is a
   * deliverable, served from its own directory, so nothing above it is exposed.
   */
  async function appRootAt(checkout, slug) {
    const atRoot = await detectionAt(checkout);
    if (atRoot.detection) return { ...atRoot, root: checkout };
    const probes = new Map();
    // Sequential on purpose: each probe fans out over PREVIEW_PROBE_FILES, so
    // scanning every directory at once would be hundreds of concurrent reads
    // against a host that may be across a network.
    for (const name of previewAppDirs(listDirs(checkout))) {
      const probe = await detectionAt(joinPath(checkout, name));
      if (probe.detection) probes.set(name, probe);
    }
    const chosen = pickAppDir([...probes.keys()], slug);
    const probe = chosen ? probes.get(chosen) : null;
    return probe
      ? { ...probe, root: joinPath(checkout, chosen) }
      : { detection: null, declared: null, root: checkout };
  }

  return { appRootAt };
}
