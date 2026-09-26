import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { stalenessOf } from "../../lib/question-staleness.mjs";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type EvidenceRow = {
  artifact_path: string;
  artifact_sha256: string;
  git_root: string | null;
  head_sha: string | null;
};
type OptionArtifact = { artifact: { absolutePath: string | null } | null };
type Question = { id: string; options: OptionArtifact[] };
type Flags = {
  docRevised: boolean;
  docRemoved: boolean;
  checkoutMoved: boolean;
};
type Touched = { commitCount: number; paths: string[] };
export type QuestionStaleness = Flags & {
  commitCount: number;
  touchedPaths: string[];
};

type QuestionStalenessDeps = {
  db: Db;
  recoveryGitEvidence: (
    path: string,
  ) => Promise<{ headSha: string | null }>;
  sha256OfHostFile: (path: string) => Promise<string | null>;
  gitTouchedSince: (gitRoot: string, fromHead: string) => Promise<Touched>;
};

export function createQuestionStaleness(deps: QuestionStalenessDeps) {
  return (cardId: string, questions: Question[]) =>
    stalenessForQuestions(deps, cardId, questions);
}

async function stalenessForQuestions(
  deps: QuestionStalenessDeps,
  cardId: string,
  questions: Question[],
): Promise<Map<string, QuestionStaleness>> {
  const out = new Map<string, QuestionStaleness>();
  try {
    const rows = evidenceRows(deps, cardId);
    if (rows.length === 0) return out;
    const state = {
      rows: new Map(rows.map((row) => [row.artifact_path, row])),
      heads: new Map<string, string | null>(),
      touched: new Map<string, Touched>(),
    };
    for (const question of questions) {
      const verdict = await questionVerdict(deps, state, question);
      if (verdict) out.set(question.id, verdict);
    }
  } catch {
    // Advisory metadata must never break card detail.
  }
  return out;
}

function evidenceRows(deps: QuestionStalenessDeps, cardId: string): EvidenceRow[] {
  return deps.db.prepare(
    "SELECT artifact_path, artifact_sha256, git_root, head_sha FROM question_evidence WHERE card_id = ?",
  ).all(cardId) as EvidenceRow[];
}

type StalenessState = {
  rows: Map<string, EvidenceRow>;
  heads: Map<string, string | null>;
  touched: Map<string, Touched>;
};

async function questionVerdict(
  deps: QuestionStalenessDeps,
  state: StalenessState,
  question: Question,
): Promise<QuestionStaleness | null> {
  const flags: Flags = { docRevised: false, docRemoved: false, checkoutMoved: false };
  let touched: Touched = { commitCount: 0, paths: [] };
  for (const option of question.options ?? []) {
    const row = state.rows.get(option?.artifact?.absolutePath ?? "");
    if (!row) continue;
    const single = await optionVerdict(deps, state, row);
    if (!single) continue;
    flags.docRevised ||= single.docRevised;
    flags.docRemoved ||= single.docRemoved;
    flags.checkoutMoved ||= single.checkoutMoved;
    if (
      single.checkoutMoved &&
      row.git_root &&
      row.head_sha &&
      touched.paths.length === 0
    ) {
      touched = await touchedSince(deps, state, row);
    }
  }
  const stale = flags.docRevised || flags.docRemoved || flags.checkoutMoved;
  return stale
    ? { ...flags, commitCount: touched.commitCount, touchedPaths: touched.paths }
    : null;
}

async function optionVerdict(
  deps: QuestionStalenessDeps,
  state: StalenessState,
  row: EvidenceRow,
): Promise<Flags | null> {
  const sha = await deps.sha256OfHostFile(row.artifact_path);
  const head = row.git_root ? await currentHead(deps, state, row.git_root) : null;
  return stalenessOf(
    {
      artifactSha256: row.artifact_sha256,
      gitRoot: row.git_root,
      headSha: row.head_sha,
    },
    { sha256: sha, headSha: head },
  );
}

async function currentHead(
  deps: QuestionStalenessDeps,
  state: StalenessState,
  gitRoot: string,
): Promise<string | null> {
  if (!state.heads.has(gitRoot)) {
    const current = await deps.recoveryGitEvidence(gitRoot).catch(() => null);
    state.heads.set(gitRoot, current?.headSha ?? null);
  }
  return state.heads.get(gitRoot) ?? null;
}

async function touchedSince(
  deps: QuestionStalenessDeps,
  state: StalenessState,
  row: EvidenceRow,
): Promise<Touched> {
  const key = `${row.git_root} ${row.head_sha}`;
  if (!state.touched.has(key)) {
    state.touched.set(
      key,
      await deps.gitTouchedSince(row.git_root!, row.head_sha!),
    );
  }
  return state.touched.get(key)!;
}
