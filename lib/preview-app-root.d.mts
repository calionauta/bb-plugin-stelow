// Type declarations for lib/preview-app-root.mjs

export declare function createAppRootResolver(effects: {
  readFile: (path: string) => Promise<string | null>;
  listDirs: (dir: string) => string[];
  joinPath: (...parts: string[]) => string;
}): {
  appRootAt: (checkout: string, slug?: string) => Promise<{
    detection: unknown;
    declared: unknown;
    root: string;
  }>;
};
