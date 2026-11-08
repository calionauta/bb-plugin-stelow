// Type declarations for lib/skills-sync-fetch.mjs

export const REPO: string;
export const SRC_PREFIX: string;
export const TREE_URL: (ref: string) => string;
export const RAW_URL: (ref: string, path: string) => string;
export function gitBlobSha(content: Uint8Array | string): string;
export function fetchTreeBlobs(ref: string): Promise<Array<{ path: string; sha: string }>>;
export function fetchStelowSkillTree(ref: string): Promise<Array<{ skill: string; rel: string; sha: string }>>;
export function fetchVerifiedBlob(ref: string, repoPath: string, sha: string): Promise<Buffer>;
