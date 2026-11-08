export declare function detectedTestCommand(entries: unknown, packageJson?: unknown): { command: string; args: string[]; display: string } | null;
export declare function sameGitEvidence(expected: { gitRoot?: string | null; headSha?: string | null } | null | undefined, observed: { gitRoot?: string | null; headSha?: string | null } | null | undefined): boolean;
export declare function verificationReadiness(run: { exit_code: number; git_root: string; head_sha: string; command?: string } | null | undefined, gitEvidence: { gitRoot?: string | null; headSha?: string | null } | null | undefined): { ready: true; error: null } | { ready: false; error: string };
export declare function scanReadiness(run: { exit_code: number; git_root: string; head_sha: string } | null | undefined, gitEvidence: { gitRoot?: string | null; headSha?: string | null } | null | undefined): { ready: true; code: null; error: null } | { ready: false; code: string; error: string };
export declare const FROZEN_ACCEPTANCE_FILE: "frozen-acceptance.json";
export declare function parseFrozenAcceptance(content: unknown): {
  baseline: Record<string, unknown> | null;
  testMap: unknown[] | null;
  redProof: unknown;
  freezeSha: string | null;
} | null;
export declare function frozenAcceptanceReadiness(input?: {
  baseline?: unknown;
  testMap?: unknown;
  redProof?: unknown;
  freezeSha?: unknown;
  headSha?: unknown;
}): { ready: true; code: null; error: null } | { ready: false; code: string; error: string };
export declare function frozenDetailView(snapshot?: unknown, headSha?: unknown): {
  frozenTestMap: Array<{ test: string; frozen: boolean; redProof: unknown }>;
  freezeSha: string | null;
  currentHeadSha: string | null;
} | null;
export declare function verifyCommandEnv(base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
