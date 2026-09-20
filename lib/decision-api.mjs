/**
 * Jev-compatible structured-decision API. One shared client for every
 * decision point: build the typed request, call the endpoint, normalize the
 * answers, and gate on confidence. The API returns decisions — never prose —
 * so every failure (network, timeout, malformed body, low confidence)
 * degrades to the caller's built-in rules instead of throwing.
 *
 * Any provider speaking the state+questions schema works here (endpoint +
 * key + model are one settings block, never per-point config).
 */

export const DECISION_API_DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const DECISION_API_DEFAULT_MODEL = "jev-latest";
export const DECISION_API_TIMEOUT_MS = 8000;
export const DECISION_STATE_MAX_CHARS = 8000;

// Explicit settings value wins; otherwise the first present env var.
export const DECISION_API_KEY_ENV_VARS = ["DECISION_API_KEY", "TYPESAFE_API_KEY"];

// Host kill switch (STELOW_DECISION_API=0): operators can block every
// outbound decision call without touching configuration. Reads degrade to
// built-in rules; api-mode writes and probes refuse naming the variable.
export function isDecisionApiDisabled(env) {
  return (env ?? {}).STELOW_DECISION_API === "0";
}

export function resolveDecisionApiKey({ storedKey, env }) {
  if (typeof storedKey === "string" && storedKey.length > 0) return { key: storedKey, source: "settings" };
  const vars = env ?? {};
  for (const name of DECISION_API_KEY_ENV_VARS) {
    const value = vars[name];
    if (typeof value === "string" && value.length > 0) return { key: value, source: "env" };
  }
  return { key: null, source: null };
}

export function isDecisionApiEndpointValid(value) {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeDecisionApiModel(value, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > 0) return text.slice(0, 120);
  return fallback;
}

// Request shaping lives here so every caller sends the same trimmed,
// bounded payload: state is capped (cost + context budget), questions ride
// unchanged, model always names the exact version under decision.
export function buildDecisionRequest({ state, questions, model }) {
  const text = typeof state === "string" ? state : JSON.stringify(state ?? "");
  return {
    state: text.slice(0, DECISION_STATE_MAX_CHARS),
    model: normalizeDecisionApiModel(model, DECISION_API_DEFAULT_MODEL),
    questions: questions ?? {},
  };
}

// Normalize one answer per question id. Unknown shapes degrade to null per
// question (never a throw): a partial response still routes the questions
// the model did answer.
export function normalizeDecisionAnswer(answer) {
  if (!answer || typeof answer !== "object") return null;
  if (answer.type === "choice" && typeof answer.choice === "string") {
    return {
      type: "choice",
      choice: answer.choice,
      probabilities: answer.probabilities ?? null,
      confidence: typeof answer.confidence === "number" ? answer.confidence : null,
    };
  }
  if (answer.type === "score" && typeof answer.score === "number") {
    return {
      type: "score",
      score: answer.score,
      probabilities: answer.probabilities ?? null,
      confidence: typeof answer.confidence === "number" ? answer.confidence : null,
    };
  }
  if (answer.type === "noul" && typeof answer.noul === "number") {
    return { type: "noul", noul: answer.noul };
  }
  return null;
}

export function parseDecisionResponse(body) {
  if (!body || typeof body !== "object" || typeof body.answers !== "object" || body.answers === null) {
    return { ok: false, error: "the Decision API response carried no answers" };
  }
  const answers = {};
  for (const [id, answer] of Object.entries(body.answers)) {
    answers[id] = normalizeDecisionAnswer(answer);
  }
  return { ok: true, answers, model: typeof body.model === "string" ? body.model : null };
}

// Confidence-gated routing: the answer tells what, the threshold tells
// whether to act. A missing confidence never acts — it escalates.
export function meetsDecisionThreshold(confidence, threshold) {
  return typeof confidence === "number" && typeof threshold === "number" && confidence >= threshold;
}

// One evaluated call. Returns a result object on every path — network
// errors, timeouts, non-2xx statuses, and malformed bodies all arrive as
// { ok: false, error } so the caller falls back to built-in rules.
export async function evaluateDecisionCall({ endpoint, apiKey, model, state, questions, timeoutMs = DECISION_API_TIMEOUT_MS, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== "function") return { ok: false, error: "no fetch implementation available" };
  if (!isDecisionApiEndpointValid(endpoint)) return { ok: false, error: "the Decision API endpoint is not an http(s) URL" };
  if (typeof apiKey !== "string" || apiKey.length === 0) return { ok: false, error: "the Decision API has no key (settings or DECISION_API_KEY)" };
  const startedAt = Date.now();
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(String(endpoint).trim(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(buildDecisionRequest({ state, questions, model })),
      signal: controller ? controller.signal : undefined,
    });
    if (!response || typeof response.status !== "number" || response.status < 200 || response.status >= 300) {
      return { ok: false, error: `the Decision API answered HTTP ${response?.status ?? "unknown"}` };
    }
    const parsed = parseDecisionResponse(await response.json());
    if (!parsed.ok) return parsed;
    return { ok: true, answers: parsed.answers, model: parsed.model, latencyMs: Date.now() - startedAt };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, error: aborted ? `the Decision API timed out after ${timeoutMs}ms` : `the Decision API call failed: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
