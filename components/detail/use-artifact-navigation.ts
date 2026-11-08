import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";
import type { HostFileTarget, WorkspaceFileTarget } from "../artifacts/artifact-inventory";

/**
 * Which document the viewer is showing, and how the reader moves to another.
 *
 * The brief behind a gate question is usually a summary: it names the stage's
 * proposal file, its contrast record, and the verification pass, but the viewer
 * used to open one file and stop. A reader comparing four interfaces had to
 * close the dialog, find each path on the card, and reopen it — which is why
 * the summary read as the whole evidence. The same directory list and the
 * relative links inside the document both navigate here, in one dialog, with a
 * back step and the file the reader came from still in reach.
 */
export type EditorTarget = WorkspaceFileTarget | HostFileTarget | null;

export type ViewerDocument = {
  display: string;
  path: string;
  target: EditorTarget;
};

export type SiblingFile = {
  name: string;
  path: string;
  absolutePath: string;
};

function targetFor(base: EditorTarget, file: SiblingFile): EditorTarget {
  if (!base) return null;
  if (base.kind === "workspace") {
    return { kind: "workspace", environmentId: base.environmentId, path: file.path };
  }
  return { kind: "host", hostId: base.hostId, path: file.absolutePath };
}

function locationFor(file: SiblingFile, base: EditorTarget): ViewerDocument {
  return { display: file.name, path: file.absolutePath, target: targetFor(base, file) };
}

function locationForPath(path: string, files: SiblingFile[], base: EditorTarget): ViewerDocument {
  const name = path.replace(/\\/g, "/").split("/").pop() || path;
  const sibling = files.find((file) => file.absolutePath === path || file.path === path);
  // A link to a file outside this folder has no relative path the host's
  // editor target can use; the reader still gets the document, and the editor
  // action stays honest by disappearing rather than pointing at a path it
  // cannot resolve.
  return { display: name, path, target: sibling ? targetFor(base, sibling) : null };
}

function useSiblingFiles(open: boolean, cardId: string, path: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [files, setFiles] = useState<SiblingFile[]>([]);
  useEffect(() => {
    if (!open || !path) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    void rpc.call("listCardFiles", { cardId, path }).then((result) => {
      if (!cancelled) setFiles(Array.isArray(result.files) ? result.files : []);
    }).catch(() => {
      if (!cancelled) setFiles([]);
    });
    return () => { cancelled = true; };
  }, [open, cardId, path, rpc]);
  return files;
}

export function useArtifactNavigation(open: boolean, initial: ViewerDocument | null, cardId: string) {
  const [current, setCurrent] = useState<ViewerDocument | null>(initial);
  const [history, setHistory] = useState<ViewerDocument[]>([]);
  // Reset on the document's IDENTITY, not on the object. Callers may build the
  // location inline, and an object dependency would then reset the reader to
  // the first file on every parent render — the exact bug the dialog's memo was
  // written to avoid, moved down into the hook where no caller can forget it.
  const identity = `${open ? "1" : "0"}\u0000${initial?.path ?? ""}\u0000${initial?.display ?? ""}`;
  const latest = useRef(initial);
  latest.current = initial;
  useEffect(() => {
    setCurrent(latest.current);
    setHistory([]);
  }, [identity]);
  const files = useSiblingFiles(open, cardId, current?.path ?? null);

  function openFile(file: SiblingFile) {
    if (current) setHistory((entries) => [...entries, current]);
    setCurrent(locationFor(file, latest.current?.target ?? null));
  }

  function openPath(path: string) {
    if (current) setHistory((entries) => [...entries, current]);
    setCurrent(locationForPath(path, files, latest.current?.target ?? null));
  }

  function back() {
    const previous = history[history.length - 1];
    if (!previous) return;
    setCurrent(previous);
    setHistory(history.slice(0, -1));
  }

  return {
    current,
    files,
    canGoBack: history.length > 0,
    openFile,
    openPath,
    back,
  };
}
