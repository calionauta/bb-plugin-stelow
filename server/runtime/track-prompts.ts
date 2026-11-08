/**
 * Worker prompts for the two standalone tracks.
 *
 * Research and explore have no stages, no gates, and no advance: each prompt
 * is a one-shot contract for a worker that owns its own state dir, writes a
 * canonical artifact, and stops. The protocol clauses stay host-owned consts
 * passed in at construction, so a track prompt can never ship without them
 * and can never paste a second, drifting copy.
 *
 * ## Why the steps carry no interpolated value
 *
 * Provider prompt caching is prefix matching: the reusable region ends at the
 * first byte that differs between two spawns. Every per-card value interpolated
 * into a shared sentence therefore ends it there, and everything behind that
 * byte is re-uploaded and re-paid as fresh input.
 *
 * These prompts used to interpolate the strategy (research) and the stage
 * (explore) in the FIRST sentence of Step 1 — 823 and 824 characters in — so
 * two cards on different tracks shared 7.2% and 9.6% of their prompt while the
 * whole shared contract sat behind the value. The steps below name
 * `<state-dir>`, `<strategy>`, `<artifact>` and friends instead, and "Your card
 * values" at the end defines each one once. Same rules, same wording, and the
 * cacheable prefix becomes the contract rather than the preamble. The numbers
 * are pinned in `tests/prompt-cache-order.test.mjs`; the ordering rule is the
 * property asserted there, because a ratio pin breaks on any legitimate edit.
 *
 * The rule this file must keep: nothing above "Your card values" may read an
 * input. A single `${input.x}` in a shared step puts the whole cache floor back
 * where it started, which is why the shared steps take no arguments at all.
 */

import { exploreArtifactFile } from "../../lib/research-artifacts.mjs";

export type TrackPromptProtocols = {
  cardOwnerRules: string;
  doneProtocolTrack: string;
  reviewProtocol: string;
  draftProtocol: string;
  userInputContract: string;
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

/** The heading every per-card block opens with, so the placeholders the steps
 * use are defined in one place and a reader can find them. */
const CARD_VALUES_HEADING = "Your card values — every <placeholder> in the steps above names one of these:";

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
  return `${protocols.doneProtocolTrack}

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

function researchPrelude(protocols: TrackPromptProtocols): string {
  // Shared-only: the role plus the owner rules. Per-card values (state dir,
  // workspace, flavor, previous thread) live in the card values block below,
  // so two cards on different state dirs share this whole region and the
  // provider prefix cache reaches the steps instead of dying at character ~140.
  return `You are running a Stelow research task inside the bb-plugin-stelow panel. ${protocols.cardOwnerRules}`;
}

/**
 * The research steps, shared verbatim across every card and round.
 *
 * Takes no arguments on purpose: an input read here is a per-card byte before
 * the card values block, which is the exact regression the file's header warns
 * about. The shape below is the plugin's parse contract — the headings are not
 * decoration, `lib/research-index.mjs` reads them.
 */
function researchSteps(): string {
  return `Step 1 — load the strategy playbook: the <strategy> method (<strategy-skill>) is provided by this \
plugin — \`bb stelow playbook\` names its path (fetch via \`npx skills add calionauta/stelow\` only \
if the playbook reports it missing), then follow that playbook — none of the build stage skills apply here.

Step 2 — research the request below inside this workspace. Research happens primarily on the WEB using your search tools — the playbook expects \
real-time sources (LinkedIn, X/Twitter, Reddit practitioner communities, industry reports), not prior knowledge. You may also read code and docs. \
If you genuinely have no web search tools available, say so explicitly in the index instead of inventing findings — never fabricate market data, \
quotes, or statistics. You MUST NOT write product code or open pull requests. Research only.

Step 3 — write your findings to <state-dir>/research-index.md (create it) in EXACTLY this shape (headings verbatim — the plugin parses them deterministically \
for review and fan-out):

    # Research index

    ## Summary
    <concise cross-strategy synthesis, evidence limits, key decisions — keep it short>

    ## Outputs
    | Strategy | Round | Output | Artifact | Notes |
    | --- | --- | --- | --- | --- |
    | <strategy> | <round-no> | <what this output is> | <path relative to the workspace root> | <notes> |

    ## Opportunities
    ### <strategy> — <today's YYYY-MM-DD date>
    - [ ] <opportunity title> — <one-line why it matters>

Unchecked boxes mean "available for fan-out" and NOTHING else — they are not task state. NEVER check a box yourself — the plugin checks the ones the \
user turns into build cards. If you run another strategy later, APPEND a new ### section under ## Opportunities plus new rows under ## Outputs; never \
rewrite existing items.`;
}

function researchRoundStep(): string {
  return `Step 3b — write this round's native output NEXT TO the index, never instead of it. Contract (the plugin enforces it in code — a round that \
fails these checks blocks Done and is flagged in the inbox, so treat this as a hard requirement, not advice):
- target: <workspaceRoot>/<round-file> — this is the deterministic destination reserved for this round. Create it with the playbook's full result \
VERBATIM. Do NOT add a manifest block for it: the card discovers this canonical round file once it has content.
- one file per write command with a direct path; never combine round + index + state.md writes in one heredoc/command chain. Prefer your host's native \
file-write tool.
- verify by reading <round-file> back: it must hold the playbook's FULL result VERBATIM — every required section, item, table, and score the \
playbook asks for — never the research index, never empty, never a condensed summary. If the read-back fails any check, rewrite immediately before finishing.
- fan-out sub-steps (e.g. JTBD's numbered prompts): save EACH beside it as <strategy-id>-<substep-slug>-r<round-no>-<round-stamp>.md (same stamp; \
<substep-slug> is the lowercase-hyphenated sub-step name), each with its own full prompt output — the host validates every substep file individually \
and blocks Done on any missing or thin one.
- scoping before broad Full Mapping: when the request names no audience, problem/job, or geography, ask FIRST via \`bb stelow ask\` (Targeted prompt vs \
Full Mapping vs Recommend) before running all ten prompts. Proceeding on assumptions is allowed only as explicitly marked hypotheses.
- self-check BEFORE finishing: run \`bb stelow verify\` — it prints PASS or names each failing round with the fix. Do NOT end your turn on a FAIL; rewrite and \
re-verify until PASS.`;
}

function researchRegistrationStep(): string {
  return `Step 4 — register the index plus any EXTRA sub-step files so each renders on the card: append one block per file to \
<state-dir>/state.md (create the artifacts: section if missing; paths relative to <workspaceRoot>; if a block with the same \
path is already there, do NOT append a duplicate):

    artifacts:
      - stage: research
        kind: document
        path: <research-index.md path relative to the workspace root>
        label: Research index
(one more block per sub-step file, with label "Round <round-no> — <strategy> (<substep-slug>)" and its own path. \
The round's own file needs no block — it is pre-registered.)

Step 5 — end your turn with one file chip per produced file: emit \`::stelow-artifact{path="<path relative to <workspaceRoot>>" display="<short file \
name>"}\` once per file (the index, the round file, and every sub-step file), each directive on its own line — bb renders these as clickable chips so the user \
can open, read, and comment on each output directly from the thread. Then emit one quality seal per produced file: \
\`::stelow-quality{path="<same relative path>"}\` once per file, each on its own line — bb revalidates each file live and renders verified / hypothesis / \
needs-work / unverified (the seal resolves from the host, never from your claim).`;
}

function researchUserContract(contract: string): string {
  return `${contract} There are no stages and no gates here: NEVER run \`bb stelow advance\`. When the index is complete with ranked \
opportunities, STOP and end your turn — the user reviews the index, marks the card Done, and fans opportunities out into build cards. If the user \
instead confirms specific opportunities in-thread, fan them out yourself ONLY after that structured confirmation: \`bb stelow fan-out --opportunity <id> \
[--opportunity ...]\` (ids from the index, never prose — the command refuses unknown ids). Stop early when the user archives the card.`;
}

function researchCardValues(input: ResearchWorkerPromptInput): string {
  return `${CARD_VALUES_HEADING}
- <state-dir>: ${input.stateDirText} — the state dir your work owns
- <workspaceRoot>: ${input.workspaceRoot} — the workspace it lives in
- <card>: ${input.displayName}
- <strategy> / <strategy-skill> / <strategy-id>: ${input.strategyLabel} / ${input.strategySkill} / ${input.strategyId}
- <round-no> / <round-stamp> / <round-file>: ${input.roundNo} / ${input.roundStamp} / ${input.roundFile}
- this run: ${researchFlavorLine(input.flavor)}${previousWorkerContext(input.previousThreadId, "research-index.md")}`;
}

function researchWorkerPrompt(
  protocols: TrackPromptProtocols,
  input: ResearchWorkerPromptInput,
): string {
  // Shared clauses first, per-card values last: the cacheable prefix ends at
  // the first per-card byte, so the state dir, card name, strategy, round,
  // flavor, and request all render after everything two cards share.
  return [
    researchPrelude(protocols),
    researchSteps(),
    researchRoundStep(),
    researchRegistrationStep(),
    researchUserContract(protocols.userInputContract),
    protocolFooter(protocols),
    researchCardValues(input),
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

function explorePrelude(protocols: TrackPromptProtocols): string {
  // Shared-only, same reason as the research prelude: per-card values live in
  // the card values block so the prefix cache survives across cards.
  return `You are running a SINGLE-STAGE Stelow exploration inside the bb-plugin-stelow panel. ${protocols.cardOwnerRules}`;
}

/** The explore steps, shared verbatim. Takes no arguments for the same reason
 * as `researchSteps`: an input read here ends the cacheable prefix. */
function exploreWorkStep(): string {
  return `Step 1 — load the stage skill: <stage> (<stage-skill>) — \`bb stelow playbook\` names its exact path. Load it \
and follow its instructions exactly.

Step 2 — apply the stage to the request below. Work STANDALONE: there is no triage, no Shape Up pipeline, no stage machine, no gates, and no \
\`bb stelow advance\`. Do NOT run the build workflow skills (stelow-workflow-entry, stelow-workflow-router, stelow-workflow-orchestrator) — only the stage \
skill above. You may read code, docs, or files in the workspace to ground the work; use the structured form below only if the input is genuinely ambiguous. \
Depth contract: the deliverable must meet its stage contract (required sections, tables, depth per the skill's Completeness contract — \
\`bb stelow verify\` enforces it and names the failing check). Full exploration: every variant the stage skill offers. \
Ask the user via the structured form whenever a choice affects the outcome — never auto-decide picks. But never park waiting for approval: \
there are no gates here, so a decision that would be a gate in the pipeline resolves via ask, then you finish.`;
}

function exploreArtifactStep(): string {
  // The catalog names the deliverable, so a technique that ships its own file
  // (a scope map, a contrast) lands under its own name and the panel, the
  // artifact registry, and `bb stelow verify` all read the same path. Resolved
  // by the same function the seal and the review CLI use: when the prompt and
  // the check disagreed on the filename, the check silently stopped firing.
  // The VALUE lives in the card values block; the step names it as <artifact>.
  return `Step 3 — produce the stage's deliverable as ONE Markdown file: <state-dir>/<artifact> (create it; overwrite any existing content \
with the fresh result). Prefer your host's native file-write tool; if you must use a shell, write ONE file per command with a direct path and read it \
back to verify it meets the stage contract (required sections, tables, depth — never a condensed summary). Self-check BEFORE finishing: run \
\`bb stelow verify\` — it prints PASS or the fix. Do NOT end your turn on a FAIL.

Step 4 — register the artifact so it renders on the card: append one block to <state-dir>/state.md (create the artifacts: section if missing; paths \
relative to <workspaceRoot>; if a block with the same path is already there, do NOT append a duplicate):

    artifacts:
      - stage: explore
        kind: document
        path: <artifact path relative to the workspace root>
        label: <stage>

Step 5 — end your turn with one file chip per produced file: emit \`::stelow-artifact{path="<path relative to <workspaceRoot>>" \
display="<stage>"}\` on its own line — bb renders these as clickable chips. Then emit \`::stelow-quality{path="<same relative path>"}\` on its \
own line — bb revalidates the file live and renders verified / hypothesis / needs-work / unverified.`;
}

function exploreUserContract(contract: string): string {
  return `${contract} When the stage deliverable is complete, STOP and end your turn — the user reviews the artifact and marks the card Done. \
Stop early when the user archives the card.`;
}

function exploreCardValues(input: ExploreWorkerPromptInput): string {
  const artifact = exploreArtifactFile(input.stage.id);
  return `${CARD_VALUES_HEADING}
- <state-dir>: ${input.stateDirText} — the state dir your work owns
- <workspaceRoot>: ${input.workspaceRoot} — the workspace it lives in
- <card>: ${input.displayName}
- <stage> / <stage-skill>: ${input.stage.label} / ${input.stage.skill}
- <artifact>: ${artifact}
- this run: ${exploreFlavorLine(input.flavor)}${previousWorkerContext(input.previousThreadId, "artifact")}`;
}

function exploreWorkerPrompt(
  protocols: TrackPromptProtocols,
  input: ExploreWorkerPromptInput,
): string {
  return [
    explorePrelude(protocols),
    exploreWorkStep(),
    exploreArtifactStep(),
    exploreUserContract(protocols.userInputContract),
    protocolFooter(protocols),
    exploreCardValues(input),
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
