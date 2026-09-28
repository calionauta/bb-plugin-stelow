/**
 * The vocabulary the lock command and the contention rule share.
 *
 * These three shapes used to be declared inside cli-lock.ts, which meant the
 * contention rule could not name its own arguments without importing the file
 * that calls it. The fix for that is not a cycle — it is giving the shared words
 * a home. A type that two modules in one slice agree on belongs to the slice,
 * not to whichever one happened to be written first.
 *
 * Moving shared vocabulary needs no lineage proof: there is no behaviour here to
 * trace, only names.
 */
import type { WorkerCard } from "../../workers-types.js";

/** What the command is being asked to do, and against which card. */
export type LockTarget = {
  op: LockOp;
  rest: string[];
  card: WorkerCard | undefined;
  claimRoot: string;
  claimScope: string | null;
  claimFiles: string[];
  at: number;
};

/** What the claim registry did, or null when it had nothing to say. */
export type ClaimOutcome = {
  acquired: Array<{ file: string; fencing: number }>;
  renewed: Array<{ file: string }>;
  stolen: Array<{ file: string; previousHolder: string; fencing: number }>;
  conflicts: ClaimConflict[];
} | null;

/** One file this card wanted and could not have. */
export type ClaimConflict = {
  file: string;
  heldBy: string;
  heldScope: string | null;
  expiresAt: number;
};

export type LockOp = "acquire" | "release" | "check";
