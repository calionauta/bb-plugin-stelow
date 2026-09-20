/**
 * Claim-first dedupe for GitHub imports. Takes `db` (better-sqlite3);
 * ownership is decided by conditional UPDATE, never by read-then-write.
 * Db shape mirrors lib/card-claims.d.mts precedent.
 */
type RunResult = { changes: number };
interface GithubClaimDb {
  prepare: (query: string) => {
    run(...values: unknown[]): RunResult;
    get(...values: unknown[]): any;
    all(...values: unknown[]): any[];
  };
}
export declare function acquireGithubImportClaim(
  db: GithubClaimDb,
  options: { key: string; repo: string; number: number; label: string; token: string; now: number },
): { owned: boolean; cardId: string | null };
export declare function completeGithubImport(
  db: GithubClaimDb,
  options: { key: string; token: string; cardId: string; label: string; now: number },
): boolean;
export declare function releaseGithubClaim(db: GithubClaimDb, options: { key: string; token: string }): void;
export declare function liveImportedKeys(db: GithubClaimDb): Set<string>;
