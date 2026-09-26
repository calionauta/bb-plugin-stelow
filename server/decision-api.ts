/**
 * The decision API and its adapters, composed.
 *
 * Everything an operator configures and everything the runtime asks for
 * meets at this one seam: createDecisionApi(ctx) returns the RPC handlers
 * plus the named runtime verbs. Each job owns a slice —
 *   decision-store            tables, rows, the normalized point view, writes
 *   decision-config-rpcs      the shared endpoint, provider, model, key, probe
 *   decision-point-rules      which mode a point accepts, refusals, merging
 *   decision-point-rpcs       reading and writing one point's settings
 *   decision-review-policy    the independent-review gate singleton
 *   decision-api-seams        route, seed, veto, severity bump
 *
 * Kill switch: STELOW_DECISION_API=0 refuses every api-mode write and
 * degrades every seam to the built-in rules before any config read, so no
 * outbound call is attempted on a host that switched them off.
 */

import {
  createDecisionApiSeams,
  type DecisionSeamDeps,
} from "./decision-api-seams.js";
import { decisionConfigHandlers } from "./decision-config-rpcs.js";
import { decisionPointHandlers } from "./decision-point-rpcs.js";
import { decisionReviewPolicyHandlers } from "./decision-review-policy.js";
import { createDecisionStore } from "./decision-store.js";

export { decisionApiRpcContract } from "./decision-api-contract.js";
export { runDecisionApiMigrations } from "./decision-store.js";
export type { PointRow } from "./decision-store.js";

interface DecisionApiDeps
  extends Omit<DecisionSeamDeps, "configRow" | "pointRow" | "parsedThresholds"> {
  presetExists: (id: string) => boolean;
}

export function createDecisionApi(ctx: DecisionApiDeps) {
  const store = createDecisionStore(ctx.db);
  const storeDeps = {
    configRow: store.configRow,
    pointRow: store.pointRow,
    parsedThresholds: store.parsedThresholds,
  };

  const handlers = {
    ...decisionConfigHandlers({ store, now: ctx.now }),
    ...decisionPointHandlers({
      bb: ctx.bb,
      store,
      now: ctx.now,
      presetExists: ctx.presetExists,
    }),
    ...decisionReviewPolicyHandlers({ bb: ctx.bb, store, now: ctx.now }),
  };

  const seams = createDecisionApiSeams({
    db: ctx.db,
    bb: ctx.bb,
    now: ctx.now,
    ...storeDeps,
    evaluateCall: ctx.evaluateCall,
    judgeViaPreset: ctx.judgeViaPreset,
  });

  return {
    handlers,
    reviewPolicy: store.readReviewPolicy,
    ...seams,
  };
}
