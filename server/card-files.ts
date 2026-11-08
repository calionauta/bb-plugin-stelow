import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { basename, dirname, isAbsolute, relative, sep } from "node:path";
import { resolveWithinRoot } from "../lib/path-jail.mjs";
import { resolveArtifactPath } from "../lib/artifact-manifest.mjs";
import { isViewableArtifactPath } from "../lib/artifact-nav.mjs";
import type { WorkerCard } from "./workers-types.js";

/**
 * The card's file doors: read one document through the checkout, and list the
 * documents beside it.
 *
 * They live together because they share the jail. The viewer follows a brief's
 * relative link into a sibling file, and a second path resolver for that hop
 * would be a second chance to escape the workspace. One resolver, one jail.
 */

type Workspace = { path: string; hostId: string | null };
type CardLookup = (cardId: string) => WorkerCard | undefined;
type WorkspaceLookup = (card: WorkerCard) => Promise<Workspace | null>;
type SiblingFile = { name: string; path: string; absolutePath: string };

export type CardFileDeps = {
  bb: BbPluginApi;
  errors: { cardNotFound: string; workspaceUnavailable: string };
  getCard: CardLookup;
  cardWorkspace: WorkspaceLookup;
};

export function readableCardPath(rootPath: string, path: string, allowlist: string[] = []): string | null {
  // The manifest fast path first (relative, no `..`, jailed to the root).
  const resolved = resolveArtifactPath(rootPath, path);
  if (resolved) return resolved;
  // No absolute-path exit: an absolute outsider used to pass when it held no
  // `..` segment, so any absolute path on the host was readable through this
  // door. Everything now resolves through the same jail — inside the
  // workspace, or inside a managed-worktree allowlist root — or it is null.
  return resolveWithinRoot(rootPath, path, { allowlist });
}

export function createCardFileHandlers({ bb, errors, getCard, cardWorkspace }: CardFileDeps) {
  const readCardFile = async ({ cardId, path }: { cardId: string; path: string }) => {
    const card = getCard(cardId);
    if (!card) return { content: null, truncated: false, error: errors.cardNotFound };
    const workspace = await cardWorkspace(card);
    if (!workspace?.path) return { content: null, truncated: false, error: errors.workspaceUnavailable };
    const full = readableCardPath(workspace.path, path);
    if (!full) return { content: null, truncated: false, error: "Path escapes the workspace." };
    return readTextFile(bb, full);
  };

  // The files beside the one being read. A gate brief is a summary that names
  // the documents it summarizes, and the reader who wants to compare them must
  // not be sent back to the card to hunt for each path: the viewer shows this
  // list and every relative Markdown link opens inside the same dialog.
  const listCardFiles = async ({ cardId, path }: { cardId: string; path: string }) => {
    const card = getCard(cardId);
    if (!card) return { directory: null, files: [], error: errors.cardNotFound };
    const workspace = await cardWorkspace(card);
    if (!workspace?.path) return { directory: null, files: [], error: errors.workspaceUnavailable };
    const full = readableCardPath(workspace.path, path);
    if (!full) return { directory: null, files: [], error: "Path escapes the workspace." };
    const directory = dirname(full);
    const relDirectory = relative(workspace.path, directory);
    if (relDirectory.startsWith("..") || isAbsolute(relDirectory)) {
      return { directory: null, files: [], error: "Path escapes the workspace." };
    }
    const listed = await bb.sdk.files.listPaths({
      path: directory,
      includeFiles: true,
      includeDirectories: false,
    }).catch(() => null);
    const entries = Array.isArray(listed?.paths) ? listed.paths : [];
    return {
      directory: relDirectory.split(sep).join("/"),
      files: siblingFiles(entries, directory, workspace.path),
      error: null,
    };
  };

  return { readCardFile, listCardFiles };
}

async function readTextFile(bb: BbPluginApi, path: string) {
  try {
    const file = await bb.sdk.files.read({ path });
    const content = typeof file.content === "string" ? file.content : null;
    if (content === null || content.includes("\0")) {
      return { content: null, truncated: false, error: "Not a readable text file." };
    }
    const limit = 200_000;
    return { content: content.slice(0, limit), truncated: content.length > limit, error: null };
  } catch {
    return { content: null, truncated: false, error: "Could not read the file." };
  }
}

/**
 * The viewable documents among a directory listing, as paths the viewer can
 * open. Anything unreadable, outside the workspace, hidden, or not a document
 * kind is dropped: the picker is navigation, not a filesystem browser.
 *
 * `listPaths` answers with names relative to the directory it was asked for
 * (`alternatives.md`), not with absolute paths. Resolving those against the
 * workspace root produced `/repo/alternatives.md` — a different, usually
 * missing file — and made the next list read the root instead of the folder.
 * The listing's own directory is the base; the workspace root only computes
 * the relative path the card RPC speaks.
 */
function siblingFiles(entries: unknown[], directory: string, rootPath: string): SiblingFile[] {
  return entries
    .map((entry) => (typeof entry === "string" ? entry : (entry as { path?: unknown } | null)?.path))
    .map((absolute) => {
      if (typeof absolute !== "string") return null;
      const resolved = readableCardPath(directory, absolute);
      if (!resolved) return null;
      const name = basename(resolved);
      if (name.startsWith(".")) return null;
      if (!isViewableArtifactPath(name)) return null;
      const rel = relative(rootPath, resolved).split(sep).join("/");
      if (!rel || rel.startsWith("..")) return null;
      return { name, path: rel, absolutePath: resolved };
    })
    .filter((file): file is SiblingFile => file !== null)
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, 100);
}
