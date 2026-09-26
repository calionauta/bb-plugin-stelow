export declare function humanStopRequest(path: unknown, value: unknown): {
  stop: true;
  question: string;
  route: string;
  staleArtifacts: string[];
} | { stop: false; reason: string };
export declare function humanStopMessage(stop: { question: string }): string;
