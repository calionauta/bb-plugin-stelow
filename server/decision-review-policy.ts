/**
 * The independent-review gate policy: one owned singleton row, off or
 * required. Reads degrade to `off` — a missing or unreadable row never
 * blocks a board; writes publish so open review gates refresh.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { DecisionStore, Mode } from "./decision-store.js";

export interface DecisionReviewPolicyDeps {
  bb: BbPluginApi;
  store: DecisionStore;
  now: () => number;
}

export function decisionReviewPolicyHandlers(ctx: DecisionReviewPolicyDeps) {
  const { bb, store, now } = ctx;
  return {
    async getReviewPolicy() {
      return store.readReviewPolicy();
    },
    async setReviewPolicy({ mode }: { mode: Mode }) {
      store.saveReviewPolicy(mode, now);
      bb.realtime.publish("board-changed", { reviewPolicy: mode });
      return { ok: true, error: null };
    },
  };
}

export type DecisionReviewPolicyHandlers = ReturnType<
  typeof decisionReviewPolicyHandlers
>;
