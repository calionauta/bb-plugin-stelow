import { DetailsDisclosure } from "../disclosure";
import { ARCHETYPE_PHILOSOPHY, EXPLORATION_ARCHETYPES } from "../../lib/exploration-archetypes.mjs";

// Progressive disclosure for the exploration knob: the choice cards name
// counts, and this names what each count explores — the archetype letters
// the worker runs plus the hybrid. Count 1 stays LLM-chosen on purpose:
// picking an archetype for a trivial change would be control without a
// decision. Closed by default; history does not push the page down.
export function ExplorationArchetypes() {
  return (
    <DetailsDisclosure summary="Which archetypes do these counts explore?">
      <ul className="space-y-1">
        {EXPLORATION_ARCHETYPES.map((row) => (
          <li key={row.count} className="break-words text-xs leading-5">
            <span className="font-mono font-medium text-foreground">{row.count}</span>
            <span className="text-muted-foreground">
              {" → "}
              {row.archetypes.length === 0 ? "model picks the best fit" : row.archetypes.join(", ")}
              {row.hybrid ? " + hybrid" : ", no hybrid"}
              {" — "}
              {row.note}
            </span>
          </li>
        ))}
      </ul>
      <ul className="space-y-1 pt-1">
        {Object.entries(ARCHETYPE_PHILOSOPHY).map(([letter, philosophy]) => (
          <li key={letter} className="text-xs leading-5 text-muted-foreground">
            <span className="font-mono font-medium text-foreground">{letter}</span> {philosophy}
          </li>
        ))}
      </ul>
    </DetailsDisclosure>
  );
}
