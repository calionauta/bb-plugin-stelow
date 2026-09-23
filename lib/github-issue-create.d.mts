export function resolveGhPath(probe: (candidate: string) => Promise<boolean>): Promise<string>;
export function issueMarker(cardId: string): string;
export function issueKey(repo: string, number: number): string;
export function buildCreateIssueArgs(input: { repo: string; title: string; body?: string }): string[];
export function issueBodyForCard(input: { prompt: string; cardId: string }): string;
export function parseCreateIssueResponse(raw: string): { number: number; url: string };
