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
  /** `PARTITION_UNDECLARED` is a refusal, not an overlap: a scope with no
   *  expandable files is an unknown footprint, and two unknown footprints are
   *  not known to be disjoint. */
  code: "PARTITION_OVERLAP" | "PARTITION_UNDECLARED" | "PARTITIONS_DISJOINT";
  overlaps: ScopePartitionOverlap[];
  /** Present only on `PARTITION_UNDECLARED`: the scopes that declared nothing. */
  undeclared?: string[];
  partitions: Record<string, string[]>;
}
export declare function expandScopeFiles(scope: ScopePartitionScope | null | undefined): string[];
export declare function scopeClaimTag(batchId: unknown, scopeId: unknown): string | null;
export declare function computeScopePartitions(scopes: readonly ScopePartitionScope[] | null | undefined): ScopePartitions;
