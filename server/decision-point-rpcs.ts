/**
 * Decision point RPCs: read every router's mode, thresholds, route, and judge,
 * and write one router's settings.
 *
 * Reads derive from the registry, so a new point needs no code here — an
 * unknown id degrades to anonymous rules-mode defaults instead of refusing.
 * Writes refuse closed through `resolvePointWrite` and publish
 * `board-changed` only once something was persisted.
 */
import { DECISION_POINTS, getDecisionPoint } from "../lib/decision-points.mjs";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  anonymousPointDef,
  resolvePointWrite,
  type PointWriteDeps,
  type PointWriteInput,
} from "./decision-point-rules.js";
import type { DecisionPointDef, DecisionStore } from "./decision-store.js";

export interface DecisionPointRpcDeps extends PointWriteDeps {
  bb: BbPluginApi;
  store: DecisionStore;
  now: () => number;
}

export function decisionPointHandlers(ctx: DecisionPointRpcDeps) {
  const { bb, store, now } = ctx;

  const pointSummary = (def: DecisionPointDef, id: string) => ({
    id,
    label: def.label,
    description: def.description,
    rules: def.rules,
    requires: def.requires ?? null,
    modes: [...def.modes],
  });

  return {
    async getDecisionPoint({ point }: { point: string }) {
      const def = getDecisionPoint(point) ?? anonymousPointDef(point);
      return {
        point,
        ...store.pointView(def, store.pointRow(point)),
      };
    },
    async listDecisionPoints() {
      const byId = new Map(store.pointRows().map((row) => [row.point, row]));
      return {
        points: DECISION_POINTS.map((def) => ({
          ...pointSummary(def, def.id),
          ...store.pointView(def, byId.get(def.id)),
        })),
      };
    },
    async setDecisionPoint(input: PointWriteInput) {
      const existing = store.pointRow(input.point);
      const resolved = resolvePointWrite(input, existing, ctx);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      store.savePoint(input.point, resolved.write, now);
      bb.realtime.publish("board-changed", { point: input.point });
      return { ok: true, error: null };
    },
  };
}

export type DecisionPointHandlers = ReturnType<typeof decisionPointHandlers>;
