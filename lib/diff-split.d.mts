export declare const MAX_DIFF_FILES: number;
export declare const MAX_PATCH_CHARS: number;
export declare function splitDiffByFile(patchText: unknown): { files: Array<{ path: string; patch: string; truncated: boolean }>; truncated: boolean };
