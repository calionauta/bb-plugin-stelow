import { cliHelpText, cliUsageLine, nearestCommand } from "../../lib/cli-suggest.mjs";

export type CliCommand = {
  name: string;
  summary: string;
  usage: string;
};

const command = (name: string, summary: string, ...usage: string[]): CliCommand => ({
  name,
  summary,
  usage: usage.join(" "),
});

export const stelowCliCommands: CliCommand[] = [
  command("status", "Show Stelow workflows", "bb stelow status [--project <proj_id>] [--json]"),
  command(
    "ask",
    "Ask blocking structured questions",
    "bb stelow ask --thread <thr_id> --question <text> [--multiple] --option <label>",
    "[--desc <text>] [--preview <text>] [--artifact <path>]...",
    "(repeat --question groups to ask several at once; write all content in English)",
  ),
  command(
    "answer",
    "Answer a card's pending questions programmatically (same rules as answering on the card)",
    "bb stelow answer --card <card_id> --question <question_id> --answer <text>",
    "[--question <question_id> --answer <text>]... [--json]",
    "(repeat pairs; every open question must be answered in one call)",
  ),
  command(
    "seed",
    "Seed state.md, transitions.md, stelow.json",
    "bb stelow seed --project <proj_id> --name <name>",
    "--intent <new-product|feature|bugfix|refactor|investigate>",
  ),
  command(
    "preview",
    "Run and inspect a card workspace's dev server",
    "bb stelow preview [status|start|stop] [--card <card_id>] [--json]",
  ),
  command("advance", "Advance to the next Stelow stage", "bb stelow advance [--project <proj_id>] [--dry-run] [--json] <stage>"),
  command("done", "Commit workflow completion (verified in code)", "bb stelow done [--card <card_id>]"),
  command("split", "Execute the approved card-split proposal (no content args)", "bb stelow split [--card <card_id>]"),
  command("playbook", "Print this card's exact state and playbook paths", "bb stelow playbook [--card <card_id>]"),
  command("doctor", "Detect workflow drift (locks, intent, state vs transitions)", "bb stelow doctor [--project <proj_id>] [--json]"),
  command("schema", "Show machine-readable subcommand contracts", "bb stelow schema [command]"),
  command(
    "sync-scopes",
    "Parse spec-tech scopes into tracking (idempotent)",
    "bb stelow sync-scopes [--project <proj_id>] [--name <workflow>] [--json]",
  ),
  command(
    "scope",
    "Validated scope transitions (single writer)",
    "bb stelow scope <start|done|seed-tasks> --scope <id>",
    "[--project <proj_id>] [--name <workflow>] [--iteration <n>] [--actual-files <a,b>]",
    "[--tasks <json>] [--start-sha <sha>] [--json]",
  ),
  command(
    "lock",
    "File-reservation locks for parallel scopes",
    "bb stelow lock <acquire|release|check> [--project <proj_id>] --scope <id>",
    "[--file <f>...] [--ttl N] [--json]",
  ),
  command("config", "Read workflow config from tracking", "bb stelow config get <field> [default] [--project <proj_id>]"),
  command(
    "fan-out",
    "Fan out index opportunities into build cards",
    "bb stelow fan-out --opportunity <id> [--opportunity ...] [--card <card_id>] [--project <proj_id>]",
  ),
  command(
    "verify",
    "Verify artifacts, or run the Build card's host-recorded tests",
    "bb stelow verify [--card <card_id>] [--tests] [--json]",
  ),
  command("gap-scopes", "Convert escalated gaps into rework scopes (idempotent)", "bb stelow gap-scopes [--card <card_id>]"),
  command(
    "metrics",
    "Lead/cycle time and gap rates per card, or fleet-wide without --card (read-only)",
    "bb stelow metrics [--json] [--card <card_id>]",
  ),
  command("storage", "Worktree disk usage attributed to cards, heaviest first (read-only)", "bb stelow storage [--json] [--card <card_id>]"),
  command(
    "manifest",
    "Paste-ready Stelow-Artifacts trailer block for commit messages (read-only)",
    "bb stelow manifest [--json] [--card <card_id>]",
  ),
  command(
    "export",
    "Refresh docs/runs/<card> plus manifest.md (idempotent, also automatic at done);",
    "--check reports content drift and uncommitted state without writing",
    "bb stelow export [--json] [--check] [--card <card_id>] [--dir <relpath>]",
  ),
  command(
    "draft",
    "Disposable Tier G draft burst on the generation preset (text-in/text-out)",
    "bb stelow draft --prompt <brief> [--json] [--card <card_id>]",
  ),
  command(
    "review",
    "Independent artifact review by the designated reviewer preset (opt-in, read-only)",
    "bb stelow review [--card <card_id>] [--artifact <path>]",
  ),
  command(
    "criteria",
    "Score an artifact against its skill's semantic criteria (advisory, read-only)",
    "bb stelow criteria --skill <skill-id> --artifact <path> [--card <card_id>] [--json]",
  ),
  command("verify-tasks", "Judge completed tasks against the working diff (advisory, read-only)", "bb stelow verify-tasks [--card <card_id>] [--json]"),
  command(
    "verify-delegation",
    "Count worker subagent delegations in the thread timeline (advisory, read-only)",
    "bb stelow verify-delegation [--card <card_id>] [--json]",
  ),
  command("gap-triage", "Second-opinion escalated critique gaps via the judge (advisory, read-only)", "bb stelow gap-triage [--card <card_id>] [--json]"),
  command("preset", "Manage agent presets", "bb stelow preset list|add|remove|assign"),
  command("help", "Show help for a subcommand", "bb stelow help [command]"),
];

export function cliUnknownResult(argv: string[]) {
  const requested = argv[0];
  const suggestion = requested
    ? nearestCommand(requested, stelowCliCommands.map((entry) => entry.name))
    : null;
  const stderr = `Unknown command "${requested ?? ""}".${suggestion ? ` Did you mean "${suggestion}"?` : ""}\n${cliUsageLine(stelowCliCommands)}`;
  return { exitCode: 2, stderr };
}

export function cliHelpResult(argv: string[]) {
  const text = cliHelpText(stelowCliCommands, argv[1]);
  return text === null ? cliUnknownResult(argv.slice(1)) : { exitCode: 0, stdout: text };
}
