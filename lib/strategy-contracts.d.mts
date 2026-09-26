// Type declarations for lib/strategy-contracts.mjs
import type { StrategyContract } from "./artifact-contracts.mjs";

export declare const STRATEGY_CONTRACTS: StrategyContract[];
export declare function contractForStrategy(id: unknown): StrategyContract | null;
