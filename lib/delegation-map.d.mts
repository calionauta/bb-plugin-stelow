
export interface DelegationSite {
  site: string;
  tier: string;
  spawn: "disposable" | "direct";
  presetSource: string;
  writes: boolean | string;
  judgedBy: string;
}

export declare function getDelegationSite(site: unknown): DelegationSite;

export declare function assertDisposableSpawn<T>(options: {
  site: unknown;
  args?: T | null;
}): T;
