/**
 * The bundled diagram renderer: is pele resolvable in this install, and at
 * which pin?
 *
 * pele ships with the plugin (`dependencies` in package.json, exact pin), so
 * there is nothing for the user to install — bb installs plugin dependencies
 * together with the plugin. The status is therefore bundled-vs-absent, never
 * host-binary present-vs-missing like the `toolStatus` rows. A failed import
 * reads as absent with the install command as the detail, never as a throw:
 * the About card renders the answer either way.
 */

export type DiagramRendererStatus = {
  present: boolean;
  version: string | null;
  detail: string;
};

export type PeleLoader = () => Promise<unknown>;

export function readDiagramRendererStatus(
  loaded: unknown,
  pinned: string,
  installCommand: string,
): DiagramRendererStatus {
  if (loaded !== null && loaded !== undefined) {
    return { present: true, version: pinned, detail: `Bundled pele v${pinned}: diagrams render inline.` };
  }
  return { present: false, version: null, detail: `Renderer absent — reinstall the plugin or run ${installCommand}.` };
}

export function createDiagramRendererHandlers(deps: { loadPele: PeleLoader; pinned: string; installCommand: string }) {
  const diagramRendererStatus = async (): Promise<DiagramRendererStatus> => {
    try {
      const loaded = await deps.loadPele();
      return readDiagramRendererStatus(loaded, deps.pinned, deps.installCommand);
    } catch {
      return readDiagramRendererStatus(null, deps.pinned, deps.installCommand);
    }
  };
  return { diagramRendererStatus };
}
