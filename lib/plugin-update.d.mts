export declare function selectOwnEntry(entries: unknown, pluginId: string): { id: string; outcome: string; installed?: { version?: unknown; display?: unknown }; candidate?: { version?: unknown; display?: unknown }; detail?: unknown } | null;
export declare function mapUpdateEntry(entry: unknown): {
  outcome: "update-available" | "current" | "incompatible" | "pinned" | "unavailable";
  installed: string | null;
  installedDisplay: string | null;
  candidate: string | null;
  candidateDisplay: string | null;
  detail: string | null;
};
export declare function shortRef(version: unknown, display: unknown): string | null;
export declare function isPathInstall(display: unknown): boolean;
