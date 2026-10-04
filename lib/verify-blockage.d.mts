export type VerifyBlockageState = "clear" | "stale" | "confirmed" | "unknown";

export type VerifyBlockageRun = {
  exitCode: number;
  headSha: string;
} | null | undefined;

export declare const VERIFY_BLOCKAGE_STATES: VerifyBlockageState[];

export declare function classifyVerifyBlockage(input: {
  latestRun?: VerifyBlockageRun;
  currentHeadSha?: string | null;
}): {
  state: VerifyBlockageState;
  exitCode: number | null;
  runHeadSha: string | null;
  currentHeadSha: string | null;
};
