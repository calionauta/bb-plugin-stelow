export function validateInterfaceContrastReceipt(receipt: unknown): string[];
export function validateHumanBoundary(boundary: unknown): string[];
export function assertBoundaryAnswerCurrent(currentVersions: unknown, answer: unknown): boolean;
export function resolveInterfaceContrastRoute(receipt: unknown): { destination: "interface" | "shape" | "research" | "human"; staleArtifacts: string[]; requiresApproval: boolean };
