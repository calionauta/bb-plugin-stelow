/**
 * The retry-transient judge: a second opinion for spawn failures the string
 * matcher cannot place. Classified errors never reach it (transient ones
 * retry, everything else fails fast); it sees only unclassified causes and
 * may spend bounded retry budget on a confident transient, or keep fail-fast.
 *
 * Self-contained on purpose: route, thresholds, and the call all resolve
 * from the database plus env, so the retry path gains no new composition
 * edge. Default mode is rules, which never calls out.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  evaluateDecisionCall,
  isDecisionApiDisabled,
} from "../lib/decision-api.mjs";
import {
  DECISION_POINT_RETRY_TRANSIENT,
  normalizePointMode,
  resolveRetryTransient,
  retryTransientQuestions,
} from "../lib/decision-points.mjs";
import { createDecisionRoute } from "./decision-route.js";
import { createDecisionStore } from "./decision-store.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;

export type RetryJudgeDeps = {
  db: Db;
  log?: (message: string) => void;
  fetchImpl?: typeof globalThis.fetch;
};

const CAUSE_MAX_CHARS = 2000;

function truncateCause(cause: string): string {
  const text = String(cause ?? "").trim();
  return text.length > CAUSE_MAX_CHARS ? `${text.slice(0, CAUSE_MAX_CHARS)}…` : text;
}

/** True only when a confident judge calls the failure transient. */
export async function judgeRetryTransientError(
  deps: RetryJudgeDeps,
  cause: string,
  attempt: number,
): Promise<boolean> {
  const text = String(cause ?? "").trim();
  if (!text) return false;
  const warn = deps.log ?? (() => undefined);
  try {
    return await judgeWithStore(deps, text, attempt, warn);
  } catch (error) {
    warn(`retry-transient judge skipped, fail-fast stands: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function judgeWithStore(
  deps: RetryJudgeDeps,
  text: string,
  attempt: number,
  warn: (message: string) => void,
): Promise<boolean> {
  if (isDecisionApiDisabled(process.env)) return false;
  const store = createDecisionStore(deps.db);
  const point = store.pointRow(DECISION_POINT_RETRY_TRANSIENT);
  const mode = normalizePointMode(point?.mode, "rules");
  if (mode !== "api") return false;
  const route = createDecisionRoute({ configRow: store.configRow }).callRoute(point);
  if (!route.usable) return false;
  let result: Awaited<ReturnType<typeof evaluateDecisionCall>>;
  try {
    result = await evaluateDecisionCall({
      provider: route.provider,
      endpoint: route.endpoint,
      apiKey: route.apiKey,
      model: route.model,
      state: `Spawn attempt ${attempt} failed before producing output.\nCause: ${truncateCause(text)}`,
      questions: retryTransientQuestions(),
      fetchImpl: deps.fetchImpl,
    });
  } catch (error) {
    warn(`retry-transient judge skipped, fail-fast stands: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
  if (!result.ok) {
    warn(`retry-transient judge skipped, fail-fast stands: ${result.error ?? "call failed"}`);
    return false;
  }
  const answer = result.answers?.transient ?? null;
  const resolved = resolveRetryTransient({
    apiNoul: answer?.type === "noul" ? answer.noul : null,
    routeAt: store.parsedThresholds(point, DECISION_POINT_RETRY_TRANSIENT).routeAt,
  });
  return resolved.retry;
}
