const ALL_VIEWS = ["board", "list", "hill"];

export function viewsForTrack(track) {
  if (track === "build") return [...ALL_VIEWS];
  if (track === "research" || track === "explore") return ["board", "list"];
  throw new Error(`Unknown board track: ${track}`);
}

export function normalizeBoardView(value, track) {
  const allowed = viewsForTrack(track);
  return typeof value === "string" && allowed.includes(value)
    ? value
    : "board";
}
