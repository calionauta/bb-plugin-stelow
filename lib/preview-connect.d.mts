// Type declarations for lib/preview-connect.mjs

export interface ConnectBridge {
  isPaired: () => Promise<boolean>;
  exposeUrl: (port: number) => Promise<string | null>;
  unexpose: (port: number) => Promise<void>;
}

export declare function createConnectBridge(effects: {
  runConnect: (args: string[]) => Promise<unknown>;
  now?: () => number;
  pairedTtlMs?: number;
}): ConnectBridge;
