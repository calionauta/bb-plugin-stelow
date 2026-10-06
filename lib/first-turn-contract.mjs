/**
 * What a worker may do before it has advanced a stage, measured from its own events.
 *
 * The rule this exists for: a worker's first turn is the most expensive and the least
 * informed. It has just been handed a 12,000-character prompt naming its stage, and
 * the skills it needs are resolved by `bb stelow playbook` — but nothing stopped it
 * from reading a family of skills before doing anything, and the family it used to be
 * told to read is 17 skills whose entry documents total 215,756 bytes (~54k tokens)
 * against the 12,100-character prompt that asked for them. Measured on this checkout:
 * a worker reading `stelow-workflow-*` files pays an order of magnitude more for
 * orientation than for the work order itself.
 *
 * Enforcement is possible because the plugin can READ the worker's events: a skill
 * load is a `toolCall` item whose arguments name a `SKILL.md`. So this is not a
 * prompt instruction that everyone hopes is followed — it is a fact derived from what
 * the worker did, which is what makes it worth stating.
 *
 * Two things are deliberately NOT violations:
 *
 *   - reading the playbook command's output, or any non-skill file, because grounding
 *     in the repository is the work;
 *   - a skill read AFTER the first advance, because that is exactly when the stage's
 *     reading list becomes relevant and the router hands it over.
 *
 * A violation is reported, never blocked. The plugin cannot stop a tool call in
 * flight, and a rule enforced by refusing work would turn a measurement into a
 * deadlock; what it can do is make the cost visible on the card so the number can be
 * argued with.
 */

/** The event item type a tool call arrives as. */
const TOOL_CALL = "toolCall";

/** A path segment that only appears when a skill's entry document is read. */
const SKILL_DOCUMENT = "SKILL.md";

/** The stage a card starts at; nothing before an advance counts as work. */
export const FIRST_STAGE = "triage";

/**
 * Every skill read a worker performed, in order, with the tool call's index.
 *
 * Reads are extracted from `item/completed` events carrying a `toolCall` item whose
 * serialised arguments mention a skill document. Serialising the whole arguments
 * object rather than reading `arguments.path` is deliberate: the field name differs
 * by tool (`path`, `file_path`, `files`), and a check that only knew one of them
 * would report a clean worker that read twelve skills.
 */
export function skillReads(events) {
  const reads = [];
  for (const event of events ?? []) {
    const item = event?.data?.item;
    if (!item || item.type !== TOOL_CALL) continue;
    const args = JSON.stringify(item.arguments ?? {});
    if (!args.includes(SKILL_DOCUMENT)) continue;
    // The skill's own directory name, so a report names which skill rather than
    // dumping a full path.
    const match = args.match(/skills\/([a-z0-9-]+)\/SKILL\.md/i);
    reads.push({
      skill: match ? match[1] : "(unnamed)",
      tool: item.tool ?? null,
      /** True when the arguments name more than one skill document, which is the
       * bulk read the rule exists to catch. */
      bulk: (args.match(/SKILL\.md/g) ?? []).length > 1,
    });
  }
  return reads;
}

/**
 * Whether the worker advanced a stage, from the same event stream.
 *
 * `bb stelow advance` is a tool call whose arguments name the verb. It is the marker
 * that separates "orientation" from "work", and the contract's whole point is that
 * skill reading belongs on the work side of that line.
 */
export function advancedFrom(events) {
  for (const event of events ?? []) {
    const item = event?.data?.item;
    if (!item || item.type !== TOOL_CALL) continue;
    const args = JSON.stringify(item.arguments ?? {});
    if (/"advance"/.test(args) || /advance\s+[a-z-]+/.test(args)) return true;
  }
  return false;
}

/**
 * The verdict for one worker: did it read skills before it advanced?
 *
 * `violations` is the list of reads that happened while the card had not advanced,
 * so a report can name them. `tokensBeforeWork` is not computed here — the caller has
 * the token reader — but the read count is, because counting reads is what this
 * module can do without the host.
 */
export function firstTurnVerdict(events) {
  const reads = skillReads(events);
  const advanced = advancedFrom(events);
  // Order matters, so the reads are split by whether an advance preceded them. The
  // event stream is chronological, and a read after the advance is legitimate.
  let seenAdvance = false;
  const before = [];
  for (const event of events ?? []) {
    const item = event?.data?.item;
    if (!item || item.type !== TOOL_CALL) continue;
    const args = JSON.stringify(item.arguments ?? {});
    if (/"advance"/.test(args) || /advance\s+[a-z-]+/.test(args)) {
      seenAdvance = true;
      continue;
    }
    if (!args.includes(SKILL_DOCUMENT)) continue;
    if (seenAdvance) continue;
    const match = args.match(/skills\/([a-z0-9-]+)\/SKILL\.md/i);
    before.push({ skill: match ? match[1] : "(unnamed)", bulk: (args.match(/SKILL\.md/g) ?? []).length > 1 });
  }
  return {
    advanced,
    readsBeforeAdvance: before,
    readsTotal: reads.length,
    /** The number that matters: how many skills were read to orient. */
    skillsReadBeforeWork: before.length,
    violated: before.length > 0,
  };
}

/**
 * The trail line a violation leaves, or `null` when the worker obeyed.
 *
 * `null` in, `null` out, so a caller can record unconditionally. The line names the
 * skills and the count, because "you read skills early" without the names is a
 * complaint rather than a record.
 */
export function firstTurnTrailLine(verdict, { estimatedTokens = null } = {}) {
  if (!verdict?.violated) return null;
  const names = [...new Set(verdict.readsBeforeAdvance.map((read) => read.skill))];
  const cost = estimatedTokens === null ? "" : ` Estimated ${estimatedTokens.toLocaleString()} tokens for orientation before any stage work.`;
  return `Orientation cost: this worker read ${names.length} skill${names.length === 1 ? "" : "s"} before advancing `
    + `(${names.join(", ")}). The reading list for the current stage is what \`bb stelow playbook\` returns; `
    + `skills load on advance.${cost}`;
}
