/**
 * Why a stage row exists, in one closed vocabulary.
 *
 * `stage.entered` derived `stage.advance` for every move, so a card dragged
 * backwards and a card that advanced were one cause — a query for "how often do
 * cards regress?" answered zero, and the direction was only visible in the
 * detail of one row.
 *
 * The order comes from the stage catalog (`STAGE_SEQUENCE`), not a second list.
 * An unknown stage keeps `stage.advance`: guessing a direction for a label this
 * build does not know would be a confident lie, and the detail still has the
 * from/to pair.
 */
import { STAGE_SEQUENCE } from "./workflow-catalog.mjs";

export function stageEntryCause(from, to) {
  if (from === null || from === undefined || from === "") return "stage.created";
  if (to === "done") return "stage.completed";
  const before = STAGE_SEQUENCE.indexOf(from);
  const after = STAGE_SEQUENCE.indexOf(to);
  if (before < 0 || after < 0) return "stage.advance";
  return after < before ? "stage.back" : "stage.advance";
}
