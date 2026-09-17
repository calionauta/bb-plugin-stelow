export declare function decideAskGate(input: {
  liveCount?: unknown;
  expiredCount?: unknown;
  kind?: unknown;
  intent?: unknown;
  stage?: unknown;
  tag?: unknown;
  forced?: unknown;
  groups?: unknown;
}): { allowed: boolean; reason: string | null; code: 0 | 1 | 2 };
