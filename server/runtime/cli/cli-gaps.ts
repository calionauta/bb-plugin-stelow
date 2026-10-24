import { tallyGaps } from "../../../lib/gap-registry.mjs";
import { formatGapTotals } from "../../../lib/metrics-format.mjs";
import type { GapTally } from "../../../lib/gap-registry.mjs";
import { scanFlags, unknownCard, usage, type CliCommandFn, type CliResult } from "./cli-contract.js";
import type { CliDeps } from "./cli-deps.js";
import type { WorkerCard } from "../../workers-types.js";

const USAGE =
  "Usage: bb stelow gaps [--card <card_id>] [--area <glob>] [--status documented|escalated] [--json]";
/** The two dispositions a reader asks for. `fixed` is a third resolution in
 * the registry and appears in the tally, never as a row: a settled finding is
 * not a flag, and the trailer already counts it. */
const STATUSES = ["documented", "escalated"];
const NO_AREA = "(no area)";
const FLEET_SQL = "SELECT * FROM cards WHERE kind = 'build' AND status != 'archived'";

/** One finding, read from a card's critique artifacts. */
type GapRow = {
  card: string;
  name: string;
  area: string | null;
  description: string;
  resolution: string;
};

type CardGaps = { card: WorkerCard; matched: boolean; rows: GapRow[] };
type GapFilter = { area: string | null; status: string | null };
type AreaGroup = { area: string | null; label: string; rows: GapRow[] };

/**
 * `bb stelow gaps` — what has already been flagged, grouped by area.
 *
 * A VIEW, not a mechanism: no table, no schema, no writes. The artifacts are
 * read by the one reader that already reads them
 * (`createCritiqueGapState` → `lib/gap-registry.mjs`), so this command cannot
 * hold a second opinion about what a gap is. It answers the question a single
 * card cannot: "three cards already flagged `tests/docs-index`".
 *
 * Exit 0 whenever the read succeeded — including zero rows, and including a
 * `--status`/`--area` that matched nothing. A view that fails because it
 * found nothing is unusable in a script; the output names what was read so a
 * zero is never mistaken for an absence of reading.
 */
export function createGapsCommand(deps: CliDeps): CliCommandFn {
  return async (argv) => {
    if (argv[0] !== "gaps") return null;
    const scan = scanFlags(argv.slice(1), {
      boolean: ["--json"],
      valued: ["--card", "--area", "--status"],
      usage: USAGE,
    });
    if (!scan.ok) return scan.result;
    const status = scan.flags.status ?? null;
    if (status !== null && !STATUSES.includes(status)) return usage(USAGE);
    const scope = gapsScope(deps, scan.flags.card);
    if ("result" in scope) return scope.result;
    const reads = await Promise.all(scope.cards.map((card) => readCard(deps, card)));
    return reportGaps(reads, {
      json: scan.flags.json === "true",
      only: scan.flags.card ?? null,
      filter: { area: scan.flags.area ?? null, status },
    });
  };
}

/** The scope is the fleet or one named card — never the calling thread's card.
 * "What has been flagged in this area" answered with the caller's own card
 * would be a narrowed read wearing the fleet's name. Archived cards drop out
 * of the default scope (their workspaces are usually gone); `--card` still
 * names one, because an explicit argument beats a default. */
function gapsScope(
  deps: CliDeps,
  cardId: string | undefined,
): { cards: WorkerCard[] } | { result: CliResult } {
  if (cardId) {
    const card = deps.getCard(cardId);
    return card ? { cards: [card] } : { result: unknownCard(cardId) };
  }
  const rows = deps.db.prepare(FLEET_SQL).all() as WorkerCard[];
  return { cards: Array.isArray(rows) ? rows : [] };
}

/** One card's findings, through the existing per-card reader. A card with no
 * matched critique is `matched: false`, which is a different fact from a card
 * whose audit found nothing — the report prints both. */
async function readCard(deps: CliDeps, card: WorkerCard): Promise<CardGaps> {
  const state = await deps.gapState(card).catch(() => null);
  if (!state?.matched) return { card, matched: false, rows: [] };
  return {
    card,
    matched: true,
    rows: state.gaps.map((gap) => ({
      card: card.id,
      name: card.display_name ?? card.name,
      area: gap.area ?? null,
      description: gap.description,
      resolution: gap.resolution,
    })),
  };
}

function statusMatches(resolution: string, status: string | null): boolean {
  if (status === null) return resolution !== "fixed";
  return resolution === (status === "escalated" ? "escalate" : "documented");
}

/** `*` is the only wildcard: `--area tests*` groups a family of areas, and a
 * plain value is an exact area. Every other character is literal, so an area
 * named after a path stays nameable. */
function areaMatcher(pattern: string | null): (area: string) => boolean {
  if (pattern === null) return () => true;
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const regexp = new RegExp(`^${source}$`);
  return (area) => regexp.test(area);
}

function shownRows(reads: CardGaps[], filter: GapFilter): GapRow[] {
  const matchesArea = areaMatcher(filter.area);
  return reads
    .flatMap((read) => read.rows)
    .filter((row) => matchesArea(row.area ?? "") && statusMatches(row.resolution, filter.status))
    .sort((left, right) => left.area === right.area
      ? left.card.localeCompare(right.card) || left.description.localeCompare(right.description)
      : (left.area ?? "").localeCompare(right.area ?? ""));
}

function groupByArea(rows: GapRow[]): AreaGroup[] {
  const groups = new Map<string, AreaGroup>();
  for (const row of rows) {
    const label = row.area ?? NO_AREA;
    const group = groups.get(label) ?? { area: row.area, label, rows: [] };
    group.rows.push(row);
    groups.set(label, group);
  }
  return [...groups.values()];
}

function reportGaps(
  reads: CardGaps[],
  options: { json: boolean; only: string | null; filter: GapFilter },
): CliResult {
  const tally = tallyGaps(reads.flatMap((read) => read.rows));
  const shown = shownRows(reads, options.filter);
  const areas = groupByArea(shown);
  const withoutCritique = reads.filter((read) => !read.matched).length;
  if (options.json) {
    const payload = {
      read: { cards: reads.length, withoutCritique, only: options.only },
      filter: options.filter,
      tally,
      shown: shown.length,
      areas: areas.map((group) => ({
        area: group.area,
        tally: tallyGaps(group.rows),
        rows: group.rows,
      })),
    };
    return { exitCode: 0, stdout: JSON.stringify(payload, null, 2) };
  }
  return { exitCode: 0, stdout: textLines(tally, shown, areas, reads.length, withoutCritique, options).join("\n") };
}

function filterNote(filter: GapFilter): string {
  const parts = [
    filter.status === null ? null : `--status ${filter.status}`,
    filter.area === null ? null : `--area ${filter.area}`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? "" : ` (${parts.join(" ")})`;
}

function textLines(
  tally: GapTally,
  shown: GapRow[],
  areas: AreaGroup[],
  cardsRead: number,
  withoutCritique: number,
  options: { filter: GapFilter },
): string[] {
  const flagged = tally.documented + tally.escalated;
  const lines = [
    formatGapTotals(tally),
    `Cards: ${cardsRead} read${withoutCritique > 0 ? ` · ${withoutCritique} with no execution critique` : ""}`,
    `Areas: ${areas.length} · ${shown.length === flagged ? `${flagged} shown` : `${shown.length} of ${flagged} shown`}${filterNote(options.filter)}`,
  ];
  for (const group of areas) lines.push("", ...areaBlock(group));
  return lines;
}

/** One area's heading plus its rows: the heading's counts are the shown rows'
 * own tally, so a heading cannot outnumber the lines under it. */
function areaBlock(group: AreaGroup): string[] {
  const tally = tallyGaps(group.rows);
  const counts = [
    tally.documented > 0 ? `${tally.documented} documented` : null,
    tally.escalated > 0 ? `${tally.escalated} escalated` : null,
  ].filter((part): part is string => part !== null);
  return [
    `${group.label} — ${counts.join(" / ")}`,
    ...group.rows.map((row) => `  ${row.resolution.padEnd(10)}  ${row.card}  ${row.description}`),
  ];
}
