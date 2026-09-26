/**
 * File mentions typed into a card's conversation.
 *
 * A mention is only offered when the path exists exactly as written. A
 * basename search used to run when nothing matched, which surfaced files the
 * request never named (a split card's prompt names the PARENT card's
 * state.md, and the search matched its own). An unfaithful suggestion is
 * worse than none, so a miss simply lists nothing.
 */
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { join } from "./root-paths.js";

export type MentionedFile = {
  path: string;
  display: string;
  absolutePath: string;
};

// Match file-ish tokens: path/to/file.ext (no spaces, may include -_./)
const FILE_TOKEN =
  /\b(?:(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:md|markdown|txt|json|yaml|yml|toml|ts|tsx|js|jsx|py|go|rs|sh|css|html|env))(?:\b|(?=[\s,.;:)]))/g;

/** The file-ish tokens in a message, deduplicated and length-bounded. */
function candidatePaths(text: string): Set<string> {
  const candidates = new Set<string>();
  for (const match of text.matchAll(FILE_TOKEN)) {
    const token = match[0]!.replace(/[.,;:)]+$/, "");
    if (token.length >= 3 && token.length <= 120) candidates.add(token);
  }
  return candidates;
}

export async function detectMentionedFiles(
  bb: BbPluginApi,
  rootPath: string | null,
  text: string,
): Promise<MentionedFile[]> {
  if (!rootPath) return [];
  const found: MentionedFile[] = [];
  for (const candidate of candidatePaths(text)) {
    try {
      await bb.sdk.files.read({ path: join(rootPath, candidate) });
      found.push({
        path: candidate,
        display: candidate,
        absolutePath: join(rootPath, candidate),
      });
    } catch {
      /* not found at that exact path — never guess */
    }
  }
  return found.slice(0, 6);
}
