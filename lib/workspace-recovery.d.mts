export declare function reportedCheckoutPaths(...texts: unknown[]): string[];
export declare function reportedRecoveryEvidence(...texts: unknown[]): Array<{ path: string; kind: "folder" | "patch" }>;
export declare function hasWorkspaceSource(entries: Array<{ name?: unknown; isDirectory?: unknown }> | null | undefined): boolean;
export declare function recoveryDisposition(input: { workspaceIsGit: boolean; hasWorkspaceSource: boolean; candidates: unknown[]; attached: boolean }): "attached" | "promote" | "external-project" | "ambiguous" | "documents-only";
export declare function recoveryMessage(kind: "attached" | "promote" | "external-project" | "ambiguous" | "documents-only"): string;
