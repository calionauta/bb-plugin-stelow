/**
 * The decision seams, assembled: the named verbs the runtime calls instead
 * of the whole api. Each seam owns its slice —
 *   decision-route            per-point route + key cascade for every call
 *   decision-seed             triage intent seeding (api or preset judge)
 *   decision-auto-continue    the resume veto
 *   decision-severity         the advisory inbox severity bump
 *
 * The dependency seam stays the public shape: callers inject the judge
 * runner and the evaluator, the host injects the database and the log.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { evaluateDecisionCall } from "../lib/decision-api.mjs";
import { createAutoContinueVeto } from "./decision-auto-continue.js";
import { createDecisionRoute } from "./decision-route.js";
import { createDecisionSeed } from "./decision-seed.js";
import { createSeverityBump } from "./decision-severity.js";
import type { ConfigRow, PointRow } from "./decision-store.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type { ConfigRow, PointRow };

export interface DecisionSeamDeps {
  db: Db;
  bb: BbPluginApi;
  now: () => number;
  configRow: () => ConfigRow | undefined;
  pointRow: (point: string) => PointRow | undefined;
  parsedThresholds: (
    row: PointRow | undefined,
    point: string,
  ) => { routeAt: number };
  evaluateCall?: typeof evaluateDecisionCall;
  judgeViaPreset: (args: {
    presetId: string;
    projectId: string | null;
    title: string;
    prompt: string;
  }) => Promise<{ ok: boolean; text: string | null; error: string | null }>;
}

export function createDecisionApiSeams(ctx: DecisionSeamDeps) {
  const shared = {
    bb: ctx.bb,
    route: createDecisionRoute(ctx),
    pointRow: ctx.pointRow,
    parsedThresholds: ctx.parsedThresholds,
    evaluateCall: ctx.evaluateCall ?? evaluateDecisionCall,
  };
  return {
    routeConfig: shared.route.routeConfig,
    ...createDecisionSeed({ ...shared, judgeViaPreset: ctx.judgeViaPreset }),
    ...createAutoContinueVeto(shared),
    ...createSeverityBump({ ...shared, db: ctx.db, now: ctx.now }),
  };
}
