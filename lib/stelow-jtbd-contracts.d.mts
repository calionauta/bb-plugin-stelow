// Type declarations for lib/stelow-jtbd-contracts.mjs
/** GENERATED upstream (`scripts/generate-jtbd-contracts.py`); the shape is the
 * only thing this host may rely on. Depth floors and check rules are policy and
 * live in `lib/jtbd-contracts.mjs`. */

export interface StelowSubstepCriterion {
  /** Stable id the host matches a policy rule against. */
  id: string;
  /** What the criterion measures. Free-form upstream, so not a closed union. */
  kind: string;
  /** The sentence the plan must satisfy. */
  text: string;
}

export interface StelowSubstep {
  slug: string;
  /** Reference file under the skill, relative to its directory. */
  ref: string;
  criteria: StelowSubstepCriterion[];
}

export interface StelowPolicy {
  slug: string;
  ref: string;
  criteria: StelowSubstepCriterion[];
}

export interface StelowJtbdContracts {
  skill: string;
  generated_by: string;
  source: string;
  policies: StelowPolicy[];
  substeps: StelowSubstep[];
}

export declare const STELOW_JTBD_CONTRACTS: StelowJtbdContracts;
