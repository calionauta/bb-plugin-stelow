/** The card identity a run's "Open" link needs, and nothing more. */
export type RunCard = {
  id: string;
  kind: "build" | "research" | "explore";
};