/**
 * Worker prompts for the two standalone tracks.
 *
 * Research and explore have no stages, no gates, and no advance: each prompt
 * is a one-shot contract for a worker that owns its own state dir, writes a
 * canonical artifact, and stops. The protocol clauses stay host-owned consts
 * passed in at construction, so a track prompt can never ship without them
 * and can never paste a second, drifting copy.
 */

import { exploreArtifactFile } from "../../lib/research-artifacts.mjs";

export type TrackPromptProtocols = {
  cardOwnerRules: string;
  doneProtocol: string;
  reviewProtocol: string;
  draftProtocol: string;
};

export type ResearchWorkerPromptInput = {
  displayName: string;
  prompt: string;
  strategyLabel: string;
  strategyId: string;
  strategySkill: string;
  stateDirText: string;
  workspaceRoot: string;
  instructions: string;
  flavor: "initial" | "restart" | "reseed" | "append";
  previousThreadId: string | null;
  roundNo: number;
  roundStamp: string;
  roundFile: string;
};

export type ExploreWorkerPromptInput = {
  displayName: string;
  prompt: string;
  /** The catalog entry: `primaryArtifact` names the file this stage delivers. */
  stage: { id: string; label: string; skill: string; primaryArtifact?: string };
  stateDirText: string;
  workspaceRoot: string;
  instructions: string;
  flavor: "initial" | "restart" | "reseed";
  previousThreadId: string | null;
};

function previousWorkerContext(previousThreadId: string | null, subject: string): string {
  if (!previousThreadId) return "";
  return ` Previous worker thread: ${previousThreadId} (archived). If the ${subject} is thin, its turn \
history may hold missing context; retrieve it with \`bb thread output ${previousThreadId}\`.`;
}

function requestTail(input: {
  prompt: string;
  instructions: string;
}): string {
  return `${input.instructions ? `Preset instructions:\n${input.instructions}\n` : ""}Request:
${input.prompt}`;
}

function protocolFooter(protocols: TrackPromptProtocols): string {
  return `${protocols.doneProtocol}

${protocols.reviewProtocol}

${protocols.draftProtocol}`;
}

function researchFlavorLine(flavor: ResearchWorkerPromptInput["flavor"]): string {
  if (flavor === "initial") return "This is a fresh research task.";
  if (flavor === "append") {
    return "A previous strategy round already wrote to research-index.md. Load the playbook below and APPEND a new ### section for it — never \
rewrite, delete, or re-check existing items.";
  }
  if (flavor === "restart") {
    return "You are being restarted mid-research with a fresh worker. Re-read your research-index.md and CONTINUE the research — do not start \
over unless the index is empty.";
  }
  return "The host re-seeded your state dir: start the research over with a fresh research-index.md.";
}

function researchPrelude(
  protocols: TrackPromptProtocols,
  input: ResearchWorkerPromptInput,
): string {
  return `You are running a Stelow research task inside the bb-plugin-stelow panel. Your work owns its own state dir \
(${input.stateDirText}) inside the workspace (${input.workspaceRoot}). ${protocols.cardOwnerRules} \
${researchFlavorLine(input.flavor)}${previousWorkerContext(input.previousThreadId, "research-index.md")}`;
}

function researchIndexStep(input: ResearchWorkerPromptInput): string {
  return `Step 1 — load the strategy playbook: the ${input.strategyLabel} method (${input.strategySkill}) is provided by this \
plugin — use \`bb skill list\` to confirm it (fetch via \`npx skills add calionauta/stelow\` only \
if missing), then follow that playbook — not the stelow-workflow-* build skills, which do not apply here.

Step 2 — research the request below inside this workspace. Research happens primarily on the WEB using your search tools — the playbook expects \
real-time sources (LinkedIn, X/Twitter, Reddit practitioner communities, industry reports), not prior knowledge. You may also read code and docs. \
If you genuinely have no web search tools available, say so explicitly in the index instead of inventing findings — never fabricate market data, \
quotes, or statistics. You MUST NOT write product code or open pull requests. Research only.

Step 3 — write your findings to <state-dir>/research-index.md (create it) in EXACTLY this shape (headings verbatim — the plugin parses them deterministically \
for review and fan-out):

    # Research index: ${input.displayName}

    ## Summary
    <concise cross-strategy synthesis, evidence limits, key decisions — keep it short>

    ## Outputs
    | Strategy | Round | Output | Artifact | Notes |
    | --- | --- | --- | --- | --- |
    | ${input.strategyLabel} | ${input.roundNo} | <what this output is> | <path relative to ${input.workspaceRoot}> | <notes> |

    ## Opportunities
    ### ${input.strategyLabel} — <today's YYYY-MM-DD date>
    - [ ] <opportunity title> — <one-line why it matters>

Unchecked boxes mean "available for fan-out" and NOTHING else — they are not task state. NEVER check a box yourself — the plugin checks the ones the \
user turns into build cards. If you run another strategy later, APPEND a new ### section under ## Opportunities plus new rows under ## Outputs; never \
rewrite existing items.`;
}

function researchRoundStep(input: ResearchWorkerPromptInput): string {
  const substepName = `${input.strategyId}-<substep-slug>-r${input.roundNo}-${input.roundStamp}.md`;
  return `Step 3b — write this round's native output NEXT TO the index, never instead of it. Contract (the plugin enforces it in code — a round that \
fails these checks blocks Done and is flagged in the inbox, so treat this as a hard requirement, not advice):
- target: <workspaceRoot>/${input.roundFile} — this is the deterministic destination reserved for this round. Create it with the playbook's full result \
VERBATIM. Do NOT add a manifest block for it: the card discovers this canonical round file once it has content.
- one file per write command with a direct path; never combine round + index + state.md writes in one heredoc/command chain. Prefer your host's native \
file-write tool.
- verify by reading ${input.roundFile} back: it must hold the playbook's FULL result VERBATIM — every required section, item, table, and score the \
playbook asks for — never the research index, never empty, never a condensed summary. If the read-back fails any check, rewrite immediately before finishing.
- fan-out sub-steps (e.g. JTBD's numbered prompts): save EACH beside it as ${substepName} (same stamp; <substep-slug> is the lowercase-hyphenated \
sub-step name), each with its own full prompt output — the host validates every substep file individually and blocks Done on any missing or thin one.
- scoping before broad Full Mapping: when the request names no audience, problem/job, or geography, ask FIRST via \`bb stelow ask\` (Targeted prompt vs \
Full Mapping vs Recommend) before running all ten prompts. Proceeding on assumptions is allowed only as explicitly marked hypotheses.
- self-check BEFORE finishing: run \`bb stelow verify\` — it prints PASS or names each failing round with the fix. Do NOT end your turn on a FAIL; rewrite and \
re-verify until PASS.`;
}

function researchRegistrationStep(input: ResearchWorkerPromptInput): string {
  return `Step 4 — register the index plus any EXTRA sub-step files so each renders on the card: append one block per file to \
<state-dir>/state.md (create the artifacts: section if missing; paths relative to the workspace root ${input.workspaceRoot}; if a block with the same \
path is already there, do NOT append a duplicate):

    artifacts:
      - stage: research
        kind: document
        path: <research-index.md path relative to ${input.workspaceRoot}>
        label: Research index
(one more block per sub-step file, with label "Round ${input.roundNo} — ${input.strategyLabel} (<substep-slug>)" and its own path. \
The round's own file needs no block — it is pre-registered.)

Step 5 — end your turn with one file chip per produced file: emit \`::stelow-artifact{path="<path relative to ${input.workspaceRoot}>" display="<short file \
name>"}\` once per file (the index, the round file, and every sub-step file), each directive on its own line — bb renders these as clickable chips so the user \
can open, read, and comment on each output directly from the thread. Then emit one quality seal per produced file: \
\`::stelow-quality{path="<same relative path>"}\` once per file, each on its own line — bb revalidates each file live and renders verified / hypothesis / \
needs-work / unverified (the seal resolves from the host, never from your claim).`;
}

const USER_INPUT_CONTRACT = `CRITICAL — User input contract:
ANY time you need user input, you MUST call the structured form, NEVER just write text like "waiting for your choice":

    bb stelow ask --thread "$BB_THREAD_ID" \\
      --question "<a single clear question>" \\
      --option "<label 1>" --option "<label 2>" [--multiple]

Batch independent questions into ONE ask call by repeating --question groups (each with its own --option labels) — the user answers them together \
instead of being pinged one by one. Ask dependent questions (where Q2 needs Q1's answer) one at a time. When the human must compare artifacts to decide \
(interface picks, plan reviews), attach each option's evidence: --desc for trade-offs, --preview for the inline glance, --artifact for the \
workspace-relative file they can open.

On timeout ("No response after Ns"), STOP and wait — the question stays answerable on the card. Never re-ask the same question.`;

function researchUserContract(): string {
  return `${USER_INPUT_CONTRACT} There are no stages and no gates here: NEVER run \`bb stelow advance\`. When the index is complete with ranked \
opportunities, STOP and end your turn — the user reviews the index, marks the card Done, and fans opportunities out into build cards. If the user \
instead confirms specific opportunities in-thread, fan them out yourself ONLY after that structured confirmation: \`bb stelow fan-out --opportunity <id> \
[--opportunity ...]\` (ids from the index, never prose — the command refuses unknown ids). Stop early when the user archives the card.`;
}

function researchWorkerPrompt(
  protocols: TrackPromptProtocols,
  input: ResearchWorkerPromptInput,
): string {
  return [
    researchPrelude(protocols, input),
    researchIndexStep(input),
    researchRoundStep(input),
    researchRegistrationStep(input),
    researchUserContract(),
    protocolFooter(protocols),
    requestTail(input),
  ].join("\n\n");
}

function exploreFlavorLine(flavor: ExploreWorkerPromptInput["flavor"]): string {
  if (flavor === "initial") return "This is a fresh single-stage exploration.";
  if (flavor === "restart") {
    return "You are being restarted mid-exploration with a fresh worker. Re-read your artifact and CONTINUE — do not start over unless it is empty.";
  }
  return "The host re-seeded your state dir: run the stage again from scratch.";
}

function explorePrelude(
  protocols: TrackPromptProtocols,
  input: ExploreWorkerPromptInput,
): string {
  return `You are running a SINGLE-STAGE Stelow exploration inside the bb-plugin-stelow panel. Your work owns its own state dir \
(${input.stateDirText}) inside the workspace (${input.workspaceRoot}). ${protocols.cardOwnerRules} ${exploreFlavorLine(input.flavor)}\
${previousWorkerContext(input.previousThreadId, "artifact")}`;
}

function exploreWorkStep(input: ExploreWorkerPromptInput): string {
  return `Step 1 — load the stage skill: ${input.stage.label} (${input.stage.skill}) is bundled with this plugin (\`bb skill list\` shows it). Load it \
and follow its instructions exactly.

Step 2 — apply the stage to the request below. Work STANDALONE: there is no triage, no Shape Up pipeline, no stage machine, no gates, and no \
\`bb stelow advance\`. Do NOT run the build workflow skills (stelow-workflow-entry, stelow-workflow-router, stelow-workflow-orchestrator) — only the stage \
skill above. You may read code, docs, or files in the workspace to ground the work; use the structured form below only if the input is genuinely ambiguous. \
Depth contract: the deliverable must meet its stage contract (required sections, tables, depth per the skill's Completeness contract — \
\`bb stelow verify\` enforces it and names the failing check). Full exploration: every variant the stage skill offers. \
Ask the user via the structured form whenever a choice affects the outcome — never auto-decide picks. But never park waiting for approval: \
there are no gates here, so a decision that would be a gate in the pipeline resolves via ask, then you finish.`;
}

function exploreArtifactStep(input: ExploreWorkerPromptInput): string {
  const { stage, workspaceRoot } = input;
  // The catalog names the deliverable, so a technique that ships its own file
  // (a scope map, a contrast) lands under its own name and the panel, the
  // artifact registry, and `bb stelow verify` all read the same path. Resolved
  // by the same function the seal and the review CLI use: when the prompt and
  // the check disagreed on the filename, the check silently stopped firing.
  const primaryArtifact = exploreArtifactFile(stage.id);
  return `Step 3 — produce the stage's deliverable as ONE Markdown file: <state-dir>/${primaryArtifact} (create it; overwrite any existing content \
with the fresh result). Prefer your host's native file-write tool; if you must use a shell, write ONE file per command with a direct path and read it \
back to verify it meets the stage contract (required sections, tables, depth — never a condensed summary). Self-check BEFORE finishing: run \
\`bb stelow verify\` — it prints PASS or the fix. Do NOT end your turn on a FAIL.

Step 4 — register the artifact so it renders on the card: append one block to <state-dir>/state.md (create the artifacts: section if missing; paths \
relative to the workspace root ${workspaceRoot}; if a block with the same path is already there, do NOT append a duplicate):

    artifacts:
      - stage: explore
        kind: document
        path: <${primaryArtifact} path relative to ${workspaceRoot}>
        label: ${stage.label}

Step 5 — end your turn with one file chip per produced file: emit \`::stelow-artifact{path="<path relative to ${workspaceRoot}>" \
display="${stage.label}"}\` on its own line — bb renders these as clickable chips. Then emit \`::stelow-quality{path="<same relative path>"}\` on its \
own line — bb revalidates the file live and renders verified / hypothesis / needs-work / unverified.`;
}

function exploreUserContract(): string {
  return `${USER_INPUT_CONTRACT} When the stage deliverable is complete, STOP and end your turn — the user reviews the artifact and marks the card Done. \
Stop early when the user archives the card.`;
}

function exploreWorkerPrompt(
  protocols: TrackPromptProtocols,
  input: ExploreWorkerPromptInput,
): string {
  return [
    explorePrelude(protocols, input),
    exploreWorkStep(input),
    exploreArtifactStep(input),
    exploreUserContract(),
    protocolFooter(protocols),
    requestTail(input),
  ].join("\n\n");
}

export function createTrackPrompts(protocols: TrackPromptProtocols) {
  return {
    researchWorkerPrompt: (input: ResearchWorkerPromptInput) =>
      researchWorkerPrompt(protocols, input),
    exploreWorkerPrompt: (input: ExploreWorkerPromptInput) =>
      exploreWorkerPrompt(protocols, input),
  };
}

export type TrackPrompts = ReturnType<typeof createTrackPrompts>;
