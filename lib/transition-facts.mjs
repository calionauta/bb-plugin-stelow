/**
 * The transition table as facts, so the state machine can be audited rather
 * than trusted.
 *
 * `parseNextStages` in `server/runtime/workflow-state.ts` reads the same file to
 * answer "where can this card go next". It is deliberately narrow: it collects
 * the target set and stops. Nothing in the suite asked the other questions a
 * state machine has to answer to be safe — is every target a stage that exists,
 * does every stage have a way out, does any stage route only to itself — and a
 * table that fails any of them is a card that stops in the middle with a good
 * error message, which is the deadlock the project's own rules call out.
 *
 * This module parses the table into a plan keyed by transition kind (`next`,
 * `accept`, `reject`, `rework`), so a caller can audit the machine in a pure
 * function with the expected stage sequence injected. No I/O, no host, no
 * spawn: the file content is the caller's problem.
 *
 * The parser is intentionally the same dialect `parseNextStages` accepts, for
 * the same documented reason: trailing `(...)` segments are human commentary
 * ("(none — stays at triage)", "(shape rework — same stage)"), not stages, and
 * a `(?=^### |\Z)`-style anchor is a trap because `\Z` is a literal `Z` in
 * JavaScript. Splitting on headers avoids both.
 */

/** The transition kinds the table may carry, in the order they read. */
export const TRANSITION_KINDS = Object.freeze(["next", "accept", "reject", "rework"]);

/** A stage id: lowercase, digits, dashes. Anything else is prose, a comment, or
 * a terminal marker — never a stage name, so it can never be routed to. */
const STAGE_TOKEN = /^[a-z][a-z0-9-]*$/;

/**
 * One stage's row: every kind mapped to the target stages it names.
 *
 * The block boundary is `parseNextStages`' own, and matching it is the whole
 * point. That function (server/runtime/workflow-state.ts) reads a stage's
 * ENTIRE section — header up to the next `###` — not the fenced part of it.
 * Reading only the fence was a divergence introduced while building this module,
 * and adversarial review demonstrated the two disagreed on a real input: a
 * `next: audit` line placed after the closing fence renders as a live transition
 * in production and was invisible here, so this audit reported a dead end that
 * the shipped parser would happily route through. An audit that disagrees with
 * the thing it audits is worse than no audit: it fails on healthy tables and
 * passes on broken ones, depending only on where the fence sits.
 *
 * What IS stripped, because the shipped parser strips it too: trailing `(...)`
 * human commentary. "(none — stays at triage)" must not become the stage `none`,
 * and "shape (shape rework — same stage)" must still yield `shape`.
 *
 * `present: false` marks a stage that has a `### header` but no parseable body
 * at all, which is a different defect from a stage with an empty `next`: the
 * first is a table the helper cannot read, the second is a deliberate terminal.
 */
export function parseTransitionRows(content) {
  const rows = {};
  const sections = String(content ?? "").split(/^### /m);
  for (const section of sections.slice(1)) {
    const newline = section.indexOf("\n");
    if (newline < 0) continue;
    const stage = section.slice(0, newline).trim();
    if (!STAGE_TOKEN.test(stage)) continue;
    const row = { stage, present: false, raw: {}, targets: {} };
    // First-wins, matching `parseNextStages`' `sections.find(...)`: a table with a
    // duplicated header would otherwise be audited as the last copy while
    // production reads the first — auditing a table that never runs.
    if (Object.hasOwn(rows, stage)) continue;
    for (const kind of TRANSITION_KINDS) row.targets[kind] = [];
    for (const line of section.split("\n").slice(1)) {
      const match = line.trim().match(/^(next|accept|reject|rework):\s*(.*)$/);
      if (!match) continue;
      const [, kind, rest] = match;
      row.present = true;
      row.raw[kind] = rest.trim();
      // The comment strip is load-bearing: a target list that carries a
      // parenthesised note keeps the note as a word if only the commas are
      // split, and drops a real target if the note makes the token fail the
      // shape test. Cut at the first "(" before splitting.
      const value = rest.split("(")[0];
      for (const token of value.split(",")) {
        const stage = token.replace(/[[\]\s"']/g, "");
        if (stage && STAGE_TOKEN.test(stage) && !row.targets[kind].includes(stage)) {
          row.targets[kind].push(stage);
        }
      }
    }
    rows[stage] = row;
  }
  return rows;
}

/**
 * The fenced code block a section owns, for the ONE fact that needs it.
 *
 * `approvalGates` uses this; `parseTransitionRows` deliberately does not. The
 * difference matters: the transition table must be read the way the shipped
 * parser reads it (whole section, fence or no fence), while `requires_approval`
 * must NOT be, because the last section swallows the document-level gate table
 * that follows it.
 */
function fencedBlock(section) {
  const open = section.indexOf("```");
  if (open < 0) return section;
  const close = section.indexOf("```", open + 3);
  return close < 0 ? section.slice(open + 3) : section.slice(open + 3, close);
}

/**
 * Every stage the table declares, in the order the file lists them. */
export function declaredStages(rows) {
  return Object.keys(rows);
}

/**
 * Everything wrong with the table, as a list a test can assert is empty.
 *
 * Each finding names the stage, the rule, and the offending value, so a failure
 * reads as the fix rather than as "an assertion failed". The rules map one to
 * one onto the ways the machine can strand a card:
 *
 *   `target-unknown`      a transition routes to a stage that does not exist —
 *                         the advance tool will refuse mid-run, at a real card
 *   `no-exit`             a stage has neither `next` nor `accept`. A card that
 *                         lands here cannot move forward at all
 *   `self-only-exit`      every exit is the stage itself. `shape` legitimately
 *                         reworks in place, but only because it also has
 *                         `next: critique`; a stage whose *only* exits are self
 *                         is a card that stops without saying it stopped
 *   `unreadable-row`      the stage has a header and no parseable body
 *   `reject-unknown`      a rejection route points nowhere, so the "take me
 *                         back" door in an error message leads to a refusal
 *
 * `terminals` is the set of stages allowed to have no forward exit (the last
 * stage of the workflow), injected so this module never bakes in which stage
 * ends the pipeline.
 */
export function auditTransitionTable(content, { terminals = [], stages = null } = {}) {
  const rows = parseTransitionRows(content);
  const declared = declaredStages(rows);
  const known = new Set(stages ?? declared);
  const terminalSet = new Set(terminals);
  const findings = [];

  for (const row of Object.values(rows)) {
    if (!row.present) {
      findings.push({ rule: "unreadable-row", stage: row.stage, value: "" });
      continue;
    }
    for (const kind of TRANSITION_KINDS) {
      for (const target of row.targets[kind]) {
        if (known.has(target)) continue;
        findings.push({
          rule: kind === "reject" ? "reject-unknown" : "target-unknown",
          stage: row.stage,
          value: `${kind}: ${target}`,
        });
      }
    }
    const exits = [...row.targets.next, ...row.targets.accept];
    const outward = exits.filter((target) => target !== row.stage);
    if (outward.length === 0 && !terminalSet.has(row.stage)) {
      findings.push({
        rule: exits.length === 0 ? "no-exit" : "self-only-exit",
        stage: row.stage,
        value: exits.join(", "),
      });
    }
  }

  return {
    rows,
    declared,
    findings,
    /** `true` only when nothing above fired. The test asserts this, and prints
     * `findings` when it does not, so the failure names the stage to fix. */
    ok: findings.length === 0,
  };
}

/**
 * The wait-relevant half of the table: which stages require human approval.
 *
 * `gate`, `int-gate`, `plan-gate`, and `diff-gate` carry
 * `requires_approval: true` in the `gate:` block, and that is the one fact that
 * distinguishes "the card is thinking" from "the card is waiting for a person" —
 * the distinction `lib/wait-attribution.mjs` needs to charge time correctly and
 * the distinction a phantom-wait check needs to keep honest. Reading it from the
 * table rather than from a hardcoded list means a new approval gate is a data
 * change, not a second source of truth.
 */
export function approvalGates(content) {
  const gates = [];
  const sections = String(content ?? "").split(/^### /m);
  for (const section of sections.slice(1)) {
    const newline = section.indexOf("\n");
    if (newline < 0) continue;
    const stage = section.slice(0, newline).trim();
    if (!STAGE_TOKEN.test(stage)) continue;
    // `requires_approval: true` shares the `gate:` line in this dialect
    // (`gate:      requires_approval: true`), so this looks for the key
    // anywhere in the block rather than anchored at a line start. A future
    // table that indents it onto its own line matches too.
    // The gate fact IS read from the fenced block, unlike the transitions: the
    // `### audit` section is the last header in the file, so it swallows the
    // document-level "Gate Conditions by review_mode" table that follows it, and
    // that table's `requires_approval: true` rows would otherwise be attributed
    // to the terminal stage. `requires_approval` appears in that table and in a
    // transition block; the fence is what separates them.
    const fenced = fencedBlock(section);
    // In this dialect the key shares the `gate:` line
    // (`gate:      requires_approval: true`), so it is matched anywhere in the
    // block rather than anchored at a line start.
    if (/requires_approval:\s*true/.test(fenced)) gates.push(stage);
  }
  return gates;
}
