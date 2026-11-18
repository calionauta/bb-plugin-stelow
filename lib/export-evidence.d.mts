export interface RegisteredSource { stage?: string | null; path: string }
export interface CopiedEntry { name: string; stage: string; sha8: string; sourcePath: string }
export interface CollectRoots { projectRoot: string; stateDir: string; files: Map<string, string> }
export interface ExportSimulation {
  registered: string[];
  copied: CopiedEntry[];
  missing: string[];
  manifest: string;
}
export interface EvidenceFixture {
  projectRoot: string;
  stateDir: string;
  cardId: string;
  cardName: string;
  stage: string;
  generatedAt: string;
  gapTotals?: unknown;
  tokens?: unknown;
  unwritable?: string[];
  ledger: string;
  files?: Record<string, string>;
}
export const MISSING_HEADING: string;
export const EVIDENCE_FIXTURE: Readonly<EvidenceFixture>;
export function readRegisteredSource(sourcePath: unknown, roots: { projectRoot: unknown; stateDir: unknown; files: Map<string, string> }): string | null;
export function collectSources(registered: readonly unknown[], roots: CollectRoots): { readable: Array<{ stage?: string | null; sourcePath: string; content: string }>; unreadable: string[] };
export function missingRows(manifest: unknown): string[];
export function ledgerArtifactPaths(ledger: unknown): string[];
export function evidenceLost(ledger: unknown, manifest: unknown): string[];
export function simulateExport(fixture: EvidenceFixture): ExportSimulation;
export function evidenceReport(fixture?: EvidenceFixture): ExportSimulation & { lost: string[] };
