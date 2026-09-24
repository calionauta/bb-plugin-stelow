export type WorkspaceLinkState = "opened" | "unavailable" | "dead" | "failed";

export type ArtifactDirectiveView =
  | { kind: "invalid" }
  | { kind: "ready"; path: string; display: string };

export type OpenCardTarget = {
  cardId: string;
  kind: "build" | "research" | "explore";
};

export function workspaceDirectivePath(value: unknown): string | null;
export function artifactDirectiveView(
  attributes: unknown,
): ArtifactDirectiveView;
export function attemptWorkspaceFileOpen(
  openWorkspaceFile: ((path: string) => boolean) | null | undefined,
  path: string,
): WorkspaceLinkState;
export function normalizeOpenCardTarget(result: unknown): OpenCardTarget | null;
