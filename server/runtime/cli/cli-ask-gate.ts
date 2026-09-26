import { decideAskGate } from "../../../lib/ask-gate.mjs";
import {
  recordAskContracts,
  validateAskContracts,
} from "../../../lib/ask-contracts.mjs";
import { parseAskGroups } from "../../../lib/question-batch.mjs";
import { englishQuestionContentError } from "../../../lib/question-presentation.mjs";
import {
  SPLIT_KEEP_LABEL,
  splitEligibility,
  validateSplitSlices,
  withStandardSplitDisclosure,
} from "../../../lib/split-proposal.mjs";
import { splitQuestionText } from "../../../lib/split-question-presentation.mjs";
import { refuse, type Refusal } from "./cli-contract.js";
import type { CliDeps, PendingAsk } from "./cli-deps.js";

export const ASK_USAGE =
  "Usage: bb stelow ask --thread <thr_id> --question <text> [--multiple] --option <label> [--desc <text>] [--preview <text>] [--artifact <path>]...";

// The parsed group keeps the parser's exact option shape (description and
// preview are strings, artifact is `{ path, display } | null`): the renderer
// and the expired-question rows read the same fields.
export type AskOption = {
  label: string;
  description: string;
  preview: string | null;
  artifact: { path: string; display?: string } | null;
};

export type AskGroup = {
  question: string;
  multiple: boolean;
  kind: "split" | "standard";
  options: AskOption[];
  contract: string | null;
};

export type AskIntent = {
  threadId: string;
  tag: "split" | null;
  groups: AskGroup[];
  batched: boolean;
};

/** Parses the ask argv: `--tag` is machine-readable (the only worker tag is
 * `split`), `--locale` is refused because question content and the card UI are
 * English-only, and repeated `--question` groups become one blocking call. */
export function parseAskIntent(
  argv: string[],
  context: { threadId?: string | null },
): AskIntent | Refusal {
  const threadId = flagValue(argv, "--thread") ?? context.threadId;
  const scanned = scanAskArgv(argv);
  if ("refusal" in scanned) return scanned;
  const tag = askTag(scanned.tag);
  if ("refusal" in tag) return tag;
  const parsed = parseAskGroups(scanned.askArgv);
  if (!threadId) return refuse({ exitCode: 2, stderr: "Missing --thread <thr_id>." });
  if (parsed.error || !parsed.groups)
    return refuse({ exitCode: 2, stderr: parsed.error ?? ASK_USAGE });
  const groups = parsed.groups.map((group) => ({
    question: group.question,
    multiple: group.multiple,
    kind: tag.tag === "split" ? ("split" as const) : ("standard" as const),
    options: group.options.map((option) => ({
      label: option.label,
      description: option.description,
      preview: option.preview,
      artifact: option.artifact,
    })),
    contract: group.contract ?? null,
  }));
  for (const group of groups) {
    const languageError = englishQuestionContentError(
      group.question,
      group.options,
    );
    if (languageError) return refuse({ exitCode: 2, stderr: languageError });
  }
  return {
    threadId,
    tag: tag.tag,
    groups,
    batched: groups.length > 1,
  };
}

type AskArgv = { askArgv: string[]; tag: "split" | "other" | null } | Refusal;

/** `--tag split` is the only worker tag: a split proposal ask. Any other value
 * refuses by name, so a typo never reaches the human as a silent standard
 * question. */
function askTag(raw: "split" | "other" | null): { tag: "split" | null } | Refusal {
  if (raw === null) return { tag: null };
  if (raw === "split") return { tag: "split" };
  return refuse({
    exitCode: 2,
    stderr:
      "Unknown --tag. The only worker ask tag is --tag split (card-split proposals at triage).",
  });
}

/** Splits the host flags from the question argv: `--tag` values are collected
 * (the last one wins, like every repeatable flag), `--locale` is refused, and
 * everything else is the question parser's business. */
function scanAskArgv(argv: string[]): AskArgv {
  const tagValues: string[] = [];
  const askArgv: string[] = [];
  for (let index = 1; index < argv.length; index++) {
    if (argv[index] === "--tag") {
      tagValues.push(argv[index + 1] ?? "");
      index++;
      continue;
    }
    if (argv[index] === "--locale")
      return refuse({
        exitCode: 2,
        stderr: "Questions are English-only; do not pass --locale.",
      });
    askArgv.push(argv[index]!);
  }
  return {
    askArgv,
    tag:
      tagValues.length > 0
        ? (tagValues[tagValues.length - 1] as "split" | "other")
        : null,
  };
}

function flagValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

type AskCard = { id: string; status: string };

/** The thread must own a card: otherwise the question would surface nowhere
 * and the persist below would silently skip. Refuse fast with the fix (this is
 * almost always a provider session id passed where the bb worker thread id
 * belongs) instead of blaming storage. */
export function askOwningCard(
  deps: CliDeps,
  threadId: string,
): AskCard | Refusal {
  const cardRow = deps.db
    .prepare("SELECT id, status FROM cards WHERE worker_thread_id = ?")
    .get(threadId) as AskCard | undefined;
  if (!cardRow)
    return refuse({
      exitCode: 2,
      stderr: `No card owns thread "${threadId}". Pass your bb worker thread id ($BB_THREAD_ID, a thr_* id — confirm with: echo $BB_THREAD_ID), \
never a provider session id nor a workflow dirHash (sw-*).`,
    });
  if (cardRow.status === "archived")
    return refuse({ exitCode: 2, stderr: "This card is archived." });
  return cardRow;
}

/** A question may be open through the host interaction service or through the
 * durable recovery fallback. This preflight runs before any intent is
 * recorded: a proposal row alone is never evidence that the person has a
 * visible form to answer. */
export async function verifyAskSurface(
  deps: CliDeps,
  threadId: string,
): Promise<PendingAsk[] | Refusal> {
  const liveAsks = await deps.pendingAsks(threadId);
  if (liveAsks === null)
    return refuse({
        exitCode: 1,
      stderr:
        "Could not verify whether a card question is already open. Retry this same ask once; do not assume a prior question is visible.",
    });
  return liveAsks;
}

/** One dispatcher owns ask-refusal precedence (lib/ask-gate): duplicate, then
 * intent, then evidence. Nothing is persisted before this call, so a refusal
 * never pings the human. */
export async function gateAsk(
  deps: CliDeps,
  cardId: string,
  liveAsks: PendingAsk[],
  tag: "split" | null,
  groups: AskGroup[],
  argv: string[],
): Promise<Refusal | null> {
  const gateCard = deps.getCard(cardId);
  const decision = decideAskGate({
    liveCount: liveAsks.length,
    expiredCount: deps.openExpiredQuestionIds(cardId).length,
    kind: gateCard?.kind,
    intent: gateCard?.intent,
    stage: gateCard ? await deps.cardStageSlug(gateCard) : null,
    tag,
    forced: argv.includes("--force"),
    groups,
  });
  if (decision.allowed) return null;
  return refuse({ exitCode: decision.code, stderr: decision.reason! });
}

/** Optional contract declaration (lib/ask-contracts): links this ask to a
 * question contract for later matching. Validated, never enforced here —
 * unknown ids with a readable checklist refuse with the valid list; without
 * one the ask records raw (fail-open). Split asks carry none (their own
 * mechanics own the semantics). */
export async function declareAskContracts(
  deps: CliDeps,
  cardId: string,
  groups: AskGroup[],
  tag: "split" | null,
): Promise<Refusal | null> {
  const declared = groups.filter(
    (group) => typeof group.contract === "string" && group.contract,
  );
  if (tag === "split" && declared.length > 0)
    return refuse({
      exitCode: 2,
      stderr: "Split asks carry no contract id — remove --contract.",
    });
  if (declared.length === 0) return null;
  const checklist = await deps.askContractChecklist(cardId);
  const verdict = validateAskContracts(
    declared.map((group) => ({ contractId: group.contract as string })),
    checklist,
  );
  if (!verdict.ok) return refuse({ exitCode: 2, stderr: verdict.error! });
  recordAskContracts(
    deps.db,
    declared.map((group) => ({
      id: deps.randomId("askc"),
      cardId,
      question: group.question,
      contractId: group.contract as string,
      askedAt: deps.now(),
    })),
  );
  return null;
}

/** A split proposal ask (lib/split-proposal): options are proposed child
 * cards, recorded by the host and executed by `bb stelow split` after
 * approval. Validated and stored BEFORE the blocking call — a refused shape
 * never pings the human. */
export async function recordSplitProposal(
  deps: CliDeps,
  cardId: string,
  groups: AskGroup[],
): Promise<Refusal | null> {
  const shape = splitAskShape(groups);
  if (shape) return shape;
  const gate = await splitAskGate(deps, cardId);
  if (gate) return gate;
  return persistSplitProposal(deps, cardId, groups[0]!);
}

/** A split ask is exactly one multi-select question: the proposed cards are
 * its options, plus one keep option the renderer and the executor own. */
function splitAskShape(groups: AskGroup[]): Refusal | null {
  if (groups.length !== 1)
    return refuse({
      exitCode: 2,
      stderr:
        'A split ask carries exactly one question: the proposed cards as its options, plus one "Keep as one card" option.',
    });
  if (!groups[0]!.multiple)
    return refuse({
      exitCode: 2,
      stderr:
        "A split ask must use --multiple so the user can approve more than one substantial deliverable (or choose Keep as one card).",
    });
  return null;
}

/** Single-source split gate (lib/split-proposal): state.md is truth, never the
 * DB cache. */
async function splitAskGate(
  deps: CliDeps,
  cardId: string,
): Promise<Refusal | null> {
  const splitCard = deps.getCard(cardId);
  if (!splitCard) return refuse({ exitCode: 2, stderr: `Unknown card "${cardId}".` });
  const gate = splitEligibility({
    kind: splitCard.kind,
    stage: await deps.cardStageSlug(splitCard),
  });
  if (!gate.ok) return refuse({ exitCode: 2, stderr: gate.error! });
  return null;
}

function persistSplitProposal(
  deps: CliDeps,
  cardId: string,
  group: AskGroup,
): Refusal | null {
  const options = group.options;
  const keepCount = options.filter(
    (option) => option.label.trim().toLowerCase() === SPLIT_KEEP_LABEL.toLowerCase(),
  ).length;
  if (keepCount !== 1)
    return refuse({
      exitCode: 2,
      stderr: `A split ask needs exactly one "${SPLIT_KEEP_LABEL}" option (exact label) so the user can veto.`,
    });
  const slices = proposedSlices(options);
  const invalid = validateSplitSlices(slices);
  if (invalid) return refuse({ exitCode: 2, stderr: invalid });
  // The worker supplies the candidate slices, but the host owns the irreversible
  // semantics. State each consequence once: candidates are a multi-select,
  // while the keep option is an exclusive alternative handled by the renderer
  // and the split executor.
  group.question = splitQuestionText(group.question);
  deps.db
    .prepare(
      "INSERT OR REPLACE INTO split_proposals (card_id, question, slices, selected, asked_at, answered_at, consumed_at, created) VALUES \
(?, ?, ?, NULL, ?, NULL, NULL, '[]')",
    )
    .run(cardId, group.question, JSON.stringify(slices), deps.now());
  return null;
}

/** The proposed child cards: every option except the keep option, which is
 * the human's veto rather than a slice. */
function proposedSlices(
  options: AskOption[],
): Array<{ title: string; desc: string | undefined }> {
  return options
    .filter(
      (option) => option.label.trim().toLowerCase() !== SPLIT_KEEP_LABEL.toLowerCase(),
    )
    .map((option) => ({ title: option.label, desc: option.description }));
}

/** Standard questions at the split point read like split decisions but
 * execute nothing: host-append the consequence disclosure to every group (live
 * form and persisted expired rows carry it alike), decided through the same
 * shared gate on slug truth. */
export async function discloseStandardSplit(
  deps: CliDeps,
  cardId: string,
  groups: AskGroup[],
): Promise<void> {
  const card = deps.getCard(cardId);
  const stage = card ? await deps.cardStageSlug(card) : null;
  if (!card) return;
  const gate = splitEligibility({ kind: card.kind, stage });
  if (!gate.ok) return;
  for (const group of groups)
    group.question = withStandardSplitDisclosure(group.question);
}

export function askTimeoutMs(): number {
  return Number(process.env.STELOW_ASK_TIMEOUT_MS ?? 60 * 60 * 1000);
}
