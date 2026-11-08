import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  formatActionRows,
  formatActionTime,
  replayTimeline,
  summarizeDetail,
  type ReplayEntry,
} from "../../../lib/action-replay.mjs";
import {
  isActionCause,
  isActionKind,
  isActionLayer,
  isActionOutcome,
} from "../../../lib/action-kinds.mjs";
import { parseSinceDuration } from "../../../lib/action-log.mjs";
import { scanFlags, usage, type CliCommandFn } from "./cli-contract.js";
import type { ActionRecorder } from "../action-log-runtime.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

type LogDeps = {
  actions?: ActionRecorder;
  db: Db;
  now: () => number;
};

/**
 * `bb stelow log` — the plugin's own flight recorder, read back.
 *
 * The command exists because every previous answer to "what happened?" was an
 * archaeology session: one table had the refusal, another the comment, a third
 * the run, and the operator joined them by hand in a shell. Two modes:
 *
 *   table    one line per recorded action, filterable and countable
 *   --replay the same facts merged with the card's other six histories, in
 *            chronological order, so a card reads as a story instead of a join
 *
 * Read-only. `--json` is the machine form of whichever mode was asked for.
 */
const USAGE = [
  "Usage: bb stelow log [--json] [--card <card_id>] [--kind <kind>] [--cause <code>]",
  "                    [--outcome ok|refused|error|skipped|partial] [--layer intent|decision|effect|environment]",
  "                    [--since 6h|7d|6w] [--limit <n>] [--replay]",
].join("\n");

const REPLAY_SOURCE_LIMIT = 400;
const REPLAY_LIMIT = 500;

export function createLogCommand(deps: LogDeps): CliCommandFn {
  return async (argv) => {
    if (argv[0] !== "log") return null;
    const scan = scanFlags(argv.slice(1), {
      boolean: ["--json", "--replay"],
      valued: ["--card", "--kind", "--cause", "--outcome", "--layer", "--since", "--limit"],
      usage: USAGE,
    });
    if (!scan.ok) return scan.result;
    const refusal = validateFlags(scan.flags);
    if (refusal) return refusal;
    if (!deps.actions) {
      return {
        exitCode: 1,
        stderr: "The action log is not available in this runtime.",
        reason: "log.unavailable",
      };
    }
    const filter = buildFilter(scan.flags, deps.now());
    if (scan.flags.replay === "true") {
      if (!filter.cardId) return usage(`${USAGE}\n\n--replay needs --card <card_id>.`);
      return replay(deps, filter.cardId, filter.since, scan.flags.json === "true");
    }
    const rows = deps.actions.list(filter);
    const historySince = oldestRecordedAt(deps);
    const shortHistory = filter.since !== undefined && historySince !== null && historySince > filter.since;
    if (scan.flags.json === "true") {
      return {
        exitCode: 0,
        stdout: JSON.stringify(
          {
            rows: rows.length,
            events: rows.reduce((sum, row) => sum + (row.occurrences ?? 1), 0),
            since: filter.since ?? null,
            historySince,
            actions: rows.map((row) => ({ ...row, detail: decodeDetail(row.detail) })),
          },
          null,
          2,
        ),
      };
    }
    const events = rows.reduce((sum, row) => sum + (row.occurrences ?? 1), 0);
    const header = `${rows.length} row${rows.length === 1 ? "" : "s"} · ${events} event${events === 1 ? "" : "s"}`
      + (filter.since ? ` · since ${formatActionTime(filter.since)}` : "")
      + (shortHistory ? ` · history starts ${formatActionTime(historySince)}` : "");
    return { exitCode: 0, stdout: `${header}\n${formatActionRows(rows)}` };
  };
}

type FlagBag = Record<string, string | undefined>;

function validateFlags(flags: FlagBag): ReturnType<typeof usage> | null {
  if (flags.kind && !isActionKind(flags.kind)) return usage(`${USAGE}\n\nUnknown kind "${flags.kind}".`);
  if (flags.cause && !isActionCause(flags.cause)) return usage(`${USAGE}\n\nMalformed cause "${flags.cause}".`);
  if (flags.outcome && !isActionOutcome(flags.outcome)) {
    return usage(`${USAGE}\n\nUnknown outcome "${flags.outcome}".`);
  }
  if (flags.layer && !isActionLayer(flags.layer)) {
    return usage(`${USAGE}\n\nUnknown layer "${flags.layer}".`);
  }
  if (flags.since && parseSinceDuration(flags.since) === null) {
    return usage(`${USAGE}\n\nMalformed --since "${flags.since}" (use 30m, 6h, 7d or 6w).`);
  }
  if (flags.limit !== undefined && !/^\d+$/.test(flags.limit)) {
    return usage(`${USAGE}\n\nMalformed --limit "${flags.limit}".`);
  }
  return null;
}

function buildFilter(flags: FlagBag, now: number) {
  const since = flags.since ? now - (parseSinceDuration(flags.since) as number) : undefined;
  return {
    cardId: flags.card || undefined,
    kind: flags.kind || undefined,
    cause: flags.cause || undefined,
    outcome: flags.outcome as "ok" | "refused" | "error" | "skipped" | "partial" | undefined,
    layer: flags.layer as "intent" | "decision" | "effect" | "environment" | undefined,
    since,
    limit: flags.limit ? Number(flags.limit) : undefined,
  };
}

function decodeDetail(detail: string): unknown {
  try {
    return JSON.parse(detail);
  } catch {
    return detail;
  }
}

/**
 * The six histories a card has, merged by timestamp. Each read is capped so a
 * pathological card cannot make the command read a year of comments to print
 * the last 500 facts; the cap is the newest rows, which is what a replay reads.
 */
function replay(deps: LogDeps, cardId: string, since: number | undefined, json: boolean) {
  const timeline = replayTimeline(collectReplaySources(deps, cardId, since), {
    since,
    limit: REPLAY_LIMIT,
  });
  if (json) {
    return {
      exitCode: 0,
      stdout: JSON.stringify({ cardId, rows: timeline.length, timeline }, null, 2),
    };
  }
  const lines = timeline.map(
    (row) => `${formatActionTime(row.at)}  ${row.source.padEnd(7)}  ${row.summary}`,
  );
  return {
    exitCode: 0,
    stdout: [
      `${timeline.length} fact${timeline.length === 1 ? "" : "s"} for ${cardId}`
        + (since ? ` · since ${formatActionTime(since)}` : ""),
      ...lines,
    ].join("\n"),
  };
}

const REPLAY_SQL = {
  comment: "SELECT created_at AS at, author, body FROM comments"
    + " WHERE card_id = ? ORDER BY created_at DESC LIMIT ?",
  stage: "SELECT entered_at AS at, stage FROM card_stage_events"
    + " WHERE card_id = ? ORDER BY entered_at DESC, id DESC LIMIT ?",
  run: "SELECT started_at AS at, recipe_id, stage, normalized_status, completed_at, error_code"
    + " FROM execution_runs WHERE card_id = ? ORDER BY started_at DESC LIMIT ?",
  verify: "SELECT created_at AS at, command, exit_code FROM verification_runs"
    + " WHERE card_id = ? ORDER BY created_at DESC LIMIT ?",
  publish: "SELECT created_at AS at, action, message, commit_sha FROM publication_events"
    + " WHERE card_id = ? ORDER BY created_at DESC LIMIT ?",
} as const;

function collectReplaySources(
  deps: LogDeps,
  cardId: string,
  since: number | undefined,
): Record<string, ReplayEntry[]> {
  return {
    action: collectActionEntries(deps, cardId, since),
    comment: rows(deps, REPLAY_SQL.comment, cardId).map((row) => ({
      at: Number(row.at),
      summary: `comment (${row.author}): ${firstLine(row.body, 160)}`,
    })),
    stage: rows(deps, REPLAY_SQL.stage, cardId).map((row) => ({
      at: Number(row.at),
      summary: `stage → ${row.stage}`,
    })),
    run: rows(deps, REPLAY_SQL.run, cardId).flatMap(runEntries),
    verify: rows(deps, REPLAY_SQL.verify, cardId).map((row) => ({
      at: Number(row.at),
      summary: `verify ${row.command} → exit ${row.exit_code}`,
    })),
    publish: rows(deps, REPLAY_SQL.publish, cardId).map((row) => ({
      at: Number(row.at),
      summary: `publish ${row.action}: ${firstLine(row.message, 120)}`
        + (row.commit_sha ? ` @${String(row.commit_sha).slice(0, 8)}` : ""),
    })),
  };
}

/** A run has two moments worth reading: it started, and it settled. A run that
 * never settled gets the first only — the missing second fact is the finding. */
function runEntries(row: Record<string, unknown>): ReplayEntry[] {
  const label = `${row.recipe_id}/${row.stage}`;
  const started = {
    at: Number(row.at),
    summary: `run ${label} → ${row.normalized_status}`
      + (row.error_code ? ` (${row.error_code})` : ""),
  };
  if (!Number.isFinite(Number(row.completed_at))) return [started];
  return [
    started,
    { at: Number(row.completed_at), summary: `run ${label} settled: ${row.normalized_status}` },
  ];
}

function collectActionEntries(
  deps: LogDeps,
  cardId: string,
  since: number | undefined,
): ReplayEntry[] {
  const rows = deps.actions?.list({ cardId, since, limit: REPLAY_SOURCE_LIMIT }) ?? [];
  return rows.map((row) => ({
    at: row.at,
    summary: `[${row.kind}] ${row.outcome}${row.cause ? ` ${row.cause}` : ""}`
      + (row.occurrences > 1 ? ` x${row.occurrences} (last ${formatActionTime(row.lastAt)})` : "")
      + summarizeDetail(row.detail),
  }));
}

function rows(
  deps: LogDeps,
  sql: string,
  cardId: string,
  limit = REPLAY_SOURCE_LIMIT,
): Array<Record<string, unknown>> {
  try {
    return deps.db.prepare(sql).all(cardId, limit) as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}

function firstLine(value: unknown, limit: number): string {
  const text = String(value ?? "").trim().split("\n")[0] ?? "";
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** The oldest row ever recorded, so a rate can say "the window is shorter than
 * you asked for" instead of silently dividing by a full one. */
function oldestRecordedAt(deps: LogDeps): number | null {
  try {
    const row = deps.db.prepare("SELECT MIN(at) AS oldest FROM action_log").get() as {
      oldest?: number | null;
    };
    return Number.isFinite(Number(row?.oldest)) ? Number(row.oldest) : null;
  } catch {
    return null;
  }
}
