import { join } from "node:path";
import { writeMergedFile } from "../../../lib/workflow-lineage.mjs";
import { cardIdOfWorkflow, orphanWorkflows, visibleWorkflows, withoutOrphans } from "../../../lib/workflow-inventory.mjs";
import { scanFlags, type CliCommandFn, type CliResult } from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";

/**
 * `bb stelow prune` — remove tracking entries whose card no longer exists.
 *
 * `stelow.json` is append-mostly: an entry is written when the card is created
 * and nothing removes it when the card is deleted. The file reached 77 entries
 * against 33 cards, and `bb stelow status` — the column a worker reads to answer
 * "is anything waiting on me?" — listed 44 ghosts at `triage` forever.
 *
 * A dry run is the default, for the same reason `gc` defaults to one: a person
 * runs this on a hunch ("status looks wrong"), and the answer to that hunch is
 * usually a list. `--apply` removes only the entries this command already
 * counted.
 *
 * The rule is the disk's, not a heuristic: a card-owned entry is `sw-card_<id>`
 * (what the plugin itself writes) and it goes only when no card row answers to
 * that id. A cardless workflow — research and explore work — has no card row BY
 * DESIGN, so it is never counted and never removed. Deleting a state DIRECTORY
 * is deliberately not offered here: that is a retention decision, and this verb
 * removes a pointer, not history.
 */

const USAGE = [
  "Usage: bb stelow prune [--json] [--apply]",
  "",
  "  --json    machine-readable counts and the names that would go",
  "  --apply   remove the tracking entries listed (default: list only)",
].join("\n");

type Entry = { id?: unknown; name?: unknown };

type Plan = {
  tracking: Record<string, unknown>;
  workflows: unknown[];
  orphans: unknown[];
  visible: unknown[];
};

export function createPruneCommand(deps: CliDeps): CliCommandFn {
  return async (argv, ctx) => {
    if (argv[0] !== "prune") return null;
    const args = argv.slice(1);
    const scan = scanFlags(args, {
      boolean: ["--json", "--apply"],
      valued: [],
      usage: USAGE,
    });
    if (!scan.ok) return scan.result;
    const root = await deps.projectRoot(ctx.projectId ?? null);
    if (!root) {
      return {
        exitCode: 1,
        stderr: "Select a bb project first: prune rewrites that project's stelow.json.",
      };
    }
    // `scanFlags` stores the flag name WITHOUT its dashes and sets "true".
    // Reading `scan.flags["--apply"]` was always undefined, so --apply silently
    // behaved like the dry run: the verb looked green and changed nothing.
    const apply = scan.flags.apply === "true";
    const json = scan.flags.json === "true";
    const plan = await planPrune(deps, root);
    if (!plan) return { exitCode: 1, stderr: "No readable stelow.json in this project root." };
    return apply ? applyPrune(deps, root, plan, json) : listPrune(plan, json);
  };
}

/** What is on disk, and which entries have no card row. */
async function planPrune(deps: CliDeps, root: string): Promise<Plan | null> {
  let tracking: Record<string, unknown> | null = null;
  try {
    const file = await deps.bb.sdk.files.read({ path: join(root, "stelow.json") });
    const parsed: unknown = JSON.parse(file.content);
    tracking = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
  if (!tracking) return null;
  const workflows = Array.isArray(tracking.workflows) ? tracking.workflows : [];
  const exists = (cardId: string) => deps.getCard(cardId) !== undefined;
  return {
    tracking,
    workflows,
    orphans: orphanWorkflows(workflows, exists),
    visible: visibleWorkflows(workflows, exists),
  };
}

function removalNames(orphans: unknown[]) {
  return orphans.map((entry) => {
    const row = entry as Entry;
    // The RAW entry names its checkout as `dirHash`; the board projection renames
    // it to `id`. Reading only `id` printed "no id" beside every removal.
    return {
      id: cardIdOfWorkflow(row),
      name: typeof row.name === "string" ? row.name : "",
    };
  });
}

/** Entries with no card row by design: research/explore work. */
function cardlessCount(workflows: unknown[]): number {
  return workflows.filter((entry) => cardIdOfWorkflow(entry) === null).length;
}

/** The default: a list, because the question a person asks is "what would go". */
function listPrune(plan: Plan, json: boolean): CliResult {
  const names = removalNames(plan.orphans);
  const cardless = cardlessCount(plan.workflows);
  const tally = { workflows: plan.workflows.length, orphans: plan.orphans.length, cardless, applied: false };
  if (plan.orphans.length === 0) {
    return {
      exitCode: 0,
      stdout: json
        ? JSON.stringify(tally, null, 2)
        : `Nothing to prune: ${plan.workflows.length} workflow entries, every one has a card or no card by design.`,
    };
  }
  return {
    exitCode: 0,
    stdout: json
      ? JSON.stringify({ ...tally, removal: names }, null, 2)
      : [
        `Workflow entries: ${plan.workflows.length} · orphaned (card row gone): ${plan.orphans.length} · cardless (kept): ${cardless}`,
        "",
        ...names.map((entry) => `- ${entry.name} (${entry.id ?? "no id"})`),
        "",
        "Remove them with: bb stelow prune --apply",
      ].join("\n"),
  };
}

/** `--apply`, which removes only what the list already showed. */
async function applyPrune(deps: CliDeps, root: string, plan: Plan, json: boolean): Promise<CliResult> {
  if (plan.orphans.length === 0) return { exitCode: 0, stdout: "Nothing to prune." };
  const exists = (cardId: string) => deps.getCard(cardId) !== undefined;
  const written = await writeMergedFile(
    deps.bb.sdk.files,
    join(root, "stelow.json"),
    root,
    // The merge runs on whatever is on disk NOW, not on the copy read a moment
    // ago: between the two reads another writer may have added a workflow, and
    // dropping an entry that no longer exists would be a silent overwrite.
    (existing: string | null) => {
      const parsed: unknown = existing ? JSON.parse(existing) : null;
      const pruned = withoutOrphans(parsed, exists);
      return pruned ? JSON.stringify(pruned, null, 2) + "\n" : null;
    },
  );
  if (!written.written) {
    return { exitCode: 1, stderr: "Could not rewrite stelow.json (it changed while reading it). Re-run prune." };
  }
  const cardless = cardlessCount(plan.workflows);
  return {
    exitCode: 0,
    stdout: json
      ? JSON.stringify({
        workflows: plan.workflows.length,
        removed: plan.orphans.length,
        cardless,
        applied: true,
      }, null, 2)
      : `Removed ${plan.orphans.length} orphaned entr${plan.orphans.length === 1 ? "y" : "ies"}; ${plan.visible.length} kept.`,
  };
}
