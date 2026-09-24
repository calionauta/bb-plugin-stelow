import { Icon } from "@/components/ui/icon";
import {
  normalizeBoardView,
  viewsForTrack,
  type BoardTrack,
  type BoardView,
} from "../../lib/board-views.mjs";

const VIEW_OPTIONS = [
  { value: "board", title: "Board view", icon: "GridView" },
  { value: "list", title: "List view", icon: "ListView" },
  { value: "hill", title: "Hill view", icon: "ChartColumn" },
] as const;

type ViewToggleProps = {
  view: BoardView;
  track: BoardTrack;
  onChange: (view: BoardView) => void;
  label: string;
};

export function ViewToggle({ view, track, onChange, label }: ViewToggleProps) {
  const current = normalizeBoardView(view, track);
  const options = VIEW_OPTIONS.filter((option) => viewsForTrack(track).includes(option.value));
  return (
    <div role="group" aria-label={label} className="flex shrink-0 items-center">
      {options.map((option) => {
        const active = current === option.value;
        const tone = active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground";
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            title={option.title}
            aria-label={option.title}
            className={[
              "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
              tone,
            ].join(" ")}
          >
            <Icon name={option.icon} className="h-4 w-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
