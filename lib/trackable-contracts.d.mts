export type TrackableWriter = "host" | "worker-propose/host-commit" | "worker";
export interface TrackableContract {
  kind: string;
  ref: string;
  writer: TrackableWriter;
  doneWhen: string[];
  artifacts: string[];
  contractFile: string | null;
  recordInline: string | null;
}
export declare const TRACKABLE_CONTRACTS: TrackableContract[];
export declare function contractForTrackable(kind: unknown): TrackableContract | null;
