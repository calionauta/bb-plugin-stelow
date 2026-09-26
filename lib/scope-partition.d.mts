export interface ScopePartitionScope {
  scopeId?: string;
  id?: string;
  targetFiles?: unknown;
  files?: unknown;
  writes?: unknown;
  reads?: unknown;
  imports?: unknown;
  transitiveFiles?: unknown;
  transitive?: unknown;
}
export interface ScopePartitionOverlap {
  file: string;
  scopes: [string, string];
}
export interface ScopePartitions {
  admitted: boolean;
  code: "PARTITION_OVERLAP" | "PARTITIONS_DISJOINT";
  overlaps: ScopePartitionOverlap[];
  partitions: Record<string, string[]>;
}
export declare function expandScopeFiles(scope: ScopePartitionScope | null | undefined): string[];
export declare function scopeClaimTag(batchId: unknown, scopeId: unknown): string | null;
export declare function computeScopePartitions(scopes: readonly ScopePartitionScope[] | null | undefined): ScopePartitions;
