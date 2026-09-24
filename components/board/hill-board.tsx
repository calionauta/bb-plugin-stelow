import { useMemo, useState } from "react";
import { CardGalleryDialog } from "./card-gallery";
import { activityDotTone } from "../dashboard/build-status-pills";
import {
  clusterHillDots,
  hillCurvePoints,
  hillDotPercent,
  hillPoint,
  hillTally,
  isOnHill,
} from "../../lib/hill-position.mjs";
import type { BoardCardItem } from "./board-cards";

function hillRegionLabel(region: string): string {
  return region === "uphill" ? "Figuring out" : "Executing";
}

const HILL_CLUSTER_CLASS =
  "stelow-hill-dot absolute flex size-5 -translate-x-1/2 translate-y-1/2 cursor-pointer items-center justify-center rounded-full "
  + "bg-muted-foreground/30 text-[10px] font-semibold text-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";
const HILL_DOT_CLASS =
  "stelow-hill-dot absolute -translate-x-1/2 translate-y-1/2 cursor-pointer rounded-full before:absolute before:-inset-2 "
  + "before:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";
const HILL_CURVE_PATH = hillCurvePoints(41)
  .map(
    (entry, index) =>
      `${index === 0 ? "M" : "L"} ${(entry.x * 100).toFixed(2)} ${(36 - entry.y * 24.8).toFixed(2)}`,
  )
  .join(" ");

type HillBoardProps = {
  cards: BoardCardItem[];
  onOpenCard: (card: BoardCardItem) => void;
};
type HillCluster = { x: number; cards: BoardCardItem[] };

export function HillBoard({ cards, onOpenCard }: HillBoardProps) {
  const [openX, setOpenX] = useState<number | null>(null);
  const onHill = useMemo(() => cards.filter(isOnHill), [cards]);
  const tally = useMemo(() => hillTally(cards), [cards]);
  const clusters = useMemo(
    () => clusterHillDots(onHill.map((card) => ({ card, point: hillPoint(card) }))),
    [onHill],
  );
  if (cards.length === 0) {
    return <p className="text-sm text-muted-foreground">No cards in this view.</p>;
  }
  if (tally.onHill === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing on the hill — {tally.archived} archived{" "}
        {tally.archived === 1 ? "card is" : "cards are"} off it.
      </p>
    );
  }
  return (
    <div>
      <HillSummary tally={tally} />
      <HillChart
        clusters={clusters}
        openX={openX}
        onToggleCluster={(x) => setOpenX((current) => (current === x ? null : x))}
        onCloseCluster={() => setOpenX(null)}
        onOpenCard={onOpenCard}
      />
      <HillLegend />
    </div>
  );
}

function HillSummary({ tally }: { tally: ReturnType<typeof hillTally> }) {
  return (
    <>
      <p className="text-xs text-muted-foreground" role="status">
        {tally.onHill} {tally.onHill === 1 ? "card" : "cards"} on the hill —{" "}
        {tally.uphill} figuring out, {tally.executing} executing, {tally.done}{" "}
        done.
        {tally.archived > 0 ? ` ${tally.archived} archived, off the hill.` : ""}
      </p>
    </>
  );
}

type HillChartProps = {
  clusters: HillCluster[];
  openX: number | null;
  onToggleCluster: (x: number) => void;
  onCloseCluster: () => void;
  onOpenCard: (card: BoardCardItem) => void;
};

function HillChart({
  clusters,
  openX,
  onToggleCluster,
  onCloseCluster,
  onOpenCard,
}: HillChartProps) {
  const openCluster =
    openX === null
      ? null
      : (clusters.find((cluster) => cluster.x === openX) ?? null);
  return (
    <div className="relative mt-2 h-64 w-full sm:h-80">
      <HillCurve />
      {clusters.map((cluster) => (
        <HillClusterButton
          key={`cluster-${cluster.x}`}
          cluster={cluster}
          isOpen={openX === cluster.x}
          onToggle={onToggleCluster}
          onOpenCard={onOpenCard}
        />
      ))}
      {openCluster ? (
        <CardGalleryDialog
          open
          title={`${openCluster.cards.length} cards · ${hillRegionLabel(hillPoint(openCluster.cards[0]!).region)}`}
          description="Cards sharing this hill position. Pick one to open it."
          cards={openCluster.cards}
          emptyText="No cards here."
          onOpenCard={(card) => {
            onCloseCluster();
            onOpenCard(card);
          }}
          onClose={onCloseCluster}
        />
      ) : null}
    </div>
  );
}

function HillCurve() {
  return (
    <svg
      aria-hidden
      className="absolute inset-0 h-full w-full text-muted-foreground/40"
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
    >
      <path
        d={HILL_CURVE_PATH}
        pathLength={100}
        className="stelow-hill-draw"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1="50"
        y1="2"
        x2="50"
        y2="38"
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="2 2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

type HillClusterButtonProps = {
  cluster: HillCluster;
  isOpen: boolean;
  onToggle: (x: number) => void;
  onOpenCard: (card: BoardCardItem) => void;
};

function HillClusterButton({
  cluster,
  isOpen,
  onToggle,
  onOpenCard,
}: HillClusterButtonProps) {
  const firstCard = cluster.cards[0]!;
  const pos = hillDotPercent({ x: cluster.x, y: hillPoint(firstCard).y });
  const attention = cluster.cards.some((card) => card.needsAttention);
  if (cluster.cards.length > 1) {
    return (
      <button
        onClick={() => onToggle(cluster.x)}
        title={`${cluster.cards.length} cards here`}
        aria-label={
          `${cluster.cards.length} cards, ` +
          `${hillRegionLabel(hillPoint(firstCard).region)}. Open the list.`
        }
        aria-expanded={isOpen}
        style={{ left: `${pos.left}%`, bottom: `${pos.bottom}%` }}
        className={`${HILL_CLUSTER_CLASS} ${attention ? "stelow-hill-attn" : ""}`}
      >
        {cluster.cards.length}
      </button>
    );
  }
  const biggest = Math.max(
    ...cluster.cards.map((card) => card.scopeSummary?.scopesTotal ?? 0),
  );
  const dotSize =
    biggest >= 8 ? "size-5" : biggest >= 4 ? "size-4" : "size-3";
  return (
    <button
      onClick={() => onOpenCard(firstCard)}
      title={
        biggest > 0
          ? `${firstCard.displayName} · ${biggest} scopes`
          : firstCard.displayName
      }
      aria-label={`Open card ${firstCard.displayName}.`}
      style={{
        left: `${pos.left}%`,
        bottom: `${pos.bottom}%`,
        animationDelay: `${Math.min(Math.round(cluster.x * 900), 900)}ms`,
      }}
      className={`${HILL_DOT_CLASS} ${dotSize} ${activityDotTone(firstCard)}${attention ? " stelow-hill-attn" : ""}`}
    />
  );
}

function HillLegend() {
  const entries = [
    ["bg-amber-500", "Needs you"],
    ["bg-primary", "Working"],
    ["bg-emerald-500", "Done"],
    ["bg-destructive", "Failed"],
    ["bg-muted-foreground/40", "Resting"],
  ];
  return (
    <>
      <div
        className="mt-1 flex items-center justify-between text-xs text-muted-foreground"
        aria-hidden
      >
        <span>Figuring out</span>
        <span>Executing</span>
      </div>
      <ul
        aria-label="Hill legend"
        className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
      >
        {entries.map(([tone, label]) => (
          <li key={label} className="flex items-center gap-1">
            <span aria-hidden className={`size-2 rounded-full ${tone}`} />
            {label}
          </li>
        ))}
      </ul>
    </>
  );
}
