type ReleaseTriple = { major: number; minor: number; patch: number };
export declare function parseReleaseTag(value: unknown): ReleaseTriple | null;
export declare function compareReleaseTags(a: unknown, b: unknown): -1 | 0 | 1;
export declare function isNewerRelease(running: unknown, latest: unknown): boolean;
export declare function fetchLatestPluginRelease(fetchImpl?: (url: string, init?: object) => Promise<{ ok: boolean; json(): Promise<unknown> }>): Promise<{ tag: string; url: string } | null>;
