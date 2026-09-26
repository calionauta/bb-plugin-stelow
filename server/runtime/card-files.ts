import { isAbsolute, relative } from "node:path";
import { z } from "zod";
import { attachmentSchema } from "../contracts.js";

/** A card's stored attachments, parsed defensively: a legacy or
 * hand-edited row reads as "no attachments" instead of throwing in the
 * middle of a command. */
export function cardAttachments(
  raw: string | null,
): Array<z.infer<typeof attachmentSchema>> {
  try {
    return z.array(attachmentSchema).parse(JSON.parse(raw ?? "[]"));
  } catch {
    return [];
  }
}

/** A path as the card should display it: workspace-relative when it lives
 * inside the workspace, unchanged otherwise. Null when the relative form
 * would escape the root. */
export function workspaceRelative(rootPath: string, path: string): string | null {
  const value = isAbsolute(path) ? relative(rootPath, path) : path;
  try {
    return safeRelative(value);
  } catch {
    return null;
  }
}

function safeRelative(path: string): string {
  if (
    !path ||
    path.startsWith("/") ||
    path.split("/").some((part) => part === "..")
  ) {
    throw new Error("Path must stay inside the project workspace.");
  }
  return path;
}
