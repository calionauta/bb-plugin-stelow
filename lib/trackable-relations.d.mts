export interface TrackableEntry {
  id?: string;
  kind?: string;
  status?: string;
  blockedBy?: unknown;
  dependsOn?: unknown;
  children?: unknown;
  tasks?: unknown;
  [key: string]: unknown;
}
export interface DanglingEdge {
  from: string;
  to: string;
}
export declare function buildRegistry(
  entries: Array<TrackableEntry | null> | null | undefined,
  options?: { defaultKind?: string },
): Map<string, TrackableEntry>;
export declare function edgesOf(entry: TrackableEntry | null | undefined): string[];
export declare function childrenOf(
  entry: TrackableEntry | null | undefined,
  registry: Map<string, TrackableEntry>,
): TrackableEntry[];
export declare function danglingEdges(registry: Map<string, TrackableEntry> | null | undefined): DanglingEdge[];
export declare function dependencyCycles(registry: Map<string, TrackableEntry> | null | undefined): string[][];
export declare function canStart(
  registry: Map<string, TrackableEntry> | null | undefined,
  id: string,
  isDone?: (status: unknown) => boolean,
): boolean;
export declare function openDependencies(
  entry: TrackableEntry | null | undefined,
  registry: Map<string, TrackableEntry> | null | undefined,
  isDone?: (status: unknown) => boolean,
): string[];
export declare function openChildren(
  entry: TrackableEntry | null | undefined,
  registry: Map<string, TrackableEntry> | null | undefined,
): TrackableEntry[];
export declare function canClose(
  entry: TrackableEntry | null | undefined,
  registry: Map<string, TrackableEntry> | null | undefined,
): boolean;
