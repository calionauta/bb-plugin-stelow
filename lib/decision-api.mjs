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

// Providers speak different wire shapes for the same decision contract.
// One table owns every provider: id, UI label, wire schema, defaults,
// key need, and whether it takes a model id. Adding a provider is one
// row; removing one is deleting its row (unknown stored ids degrade to
// jev — a misconfigured name never reroutes to an unintended shape).
// Schemas: "jev" (state + questions: Typesafe, djev, OpenJev, Simple Jev)
// and "labels" (classifier.dev and compatibles, Choice only).
export const DECISION_PROVIDERS = [
  {
    id: "jev",
    label: "TypeSafe AI's Jev-compatible",
    schema: "jev",
    defaultEndpoint: "https://api.typesafe.ai/v1/systemone",
    defaultModel: "jev-latest",
    needsKey: true,
    takesModel: true,
  },
  {
    id: "classifier",
    label: "classifier.dev (labels, keyless)",
    schema: "labels",
    defaultEndpoint: "https://classifier.dev",
    defaultModel: "",
    needsKey: false,
    takesModel: false,
  },
  {
    id: "simplejev",
    label: "Simple Jev demo (keyless)",
    schema: "jev",
    defaultEndpoint: "https://simple-jev-demo-api.featherless.ai/v1/classifier",
    defaultModel: "featherless-ai/Qwen3.6-35B-A3B-classifier",
    needsKey: false,
    takesModel: true,
  },
  {
    id: "openjev",
    label: "OpenJev via Modal (keyless)",
    schema: "jev",
    defaultEndpoint: "https://ekzhang--openjev-sglang-openjev.us-west.modal.direct/v1/systemone",
    defaultModel: "jev-latest",
    needsKey: false,
    takesModel: true,
  },
];
export const CLASSIFIER_DEFAULT_ENDPOINT = "https://classifier.dev";

export function providerById(id) {
  return DECISION_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

export function normalizeDecisionProvider(value, fallback = "jev") {
  const id = typeof value === "string" ? value : fallback;
  return providerById(id) ? id : fallback;
}

export function providerRequiresKey(provider) {
  return (providerById(normalizeDecisionProvider(provider))?.needsKey) ?? true;
}

export function defaultEndpointFor(provider) {
  return providerById(normalizeDecisionProvider(provider))?.defaultEndpoint ?? DECISION_API_DEFAULT_ENDPOINT;
}

export function defaultModelFor(provider) {
  const entry = providerById(normalizeDecisionProvider(provider));
  return entry && entry.defaultModel ? entry.defaultModel : DECISION_API_DEFAULT_MODEL;
}

export function providerTakesModel(provider) {
  return (providerById(normalizeDecisionProvider(provider))?.takesModel) ?? true;
}

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

// Classifier wire shape (labels schema): one Choice question per call maps
// to { input, labels, instructions }, answered by results[0]. Noul and
// Score have no labels equivalent — callers fall back to built-in rules.
export function buildClassifierRequest({ state, questions }) {
  const entries = Object.entries(questions ?? {});
  if (entries.length !== 1) return { ok: false, error: "classifier provider answers one Choice question per call" };
  const [id, question] = entries[0];
  const criteria = question && typeof question === "object" ? question.criteria : null;
  if (!question || question.type !== "choice" || !criteria || typeof criteria !== "object") {
    return { ok: false, error: "classifier provider supports Choice questions with criteria" };
  }
  const labels = Object.keys(criteria);
  if (labels.length < 2) return { ok: false, error: "classifier provider needs at least 2 labels" };
  const text = typeof state === "string" ? state : JSON.stringify(state ?? "");
  const lines = [question.instructions, ...labels.map((label) => `${label}: ${criteria[label]}`)].filter((line) => typeof line === "string" && line.length > 0);
  return { ok: true, id, body: { input: text.slice(0, DECISION_STATE_MAX_CHARS), labels, instructions: lines.join("\n") } };
}

export function parseClassifierResponse(body, id, criteria) {
  const result = body && typeof body === "object" && Array.isArray(body.results) ? body.results[0] : null;
  if (!result || typeof result.label !== "string") return { ok: false, error: "the classifier response carried no label" };
  if (!criteria || typeof criteria !== "object" || !Object.hasOwn(criteria, result.label)) return { ok: true, answers: { [id]: null }, model: null };
  return {
    ok: true,
    answers: {
      [id]: {
        type: "choice",
        choice: result.label,
        probabilities: result.scores ?? null,
        confidence: typeof result.confidence === "number" ? result.confidence : null,
      },
    },
    model: typeof body.model === "string" ? body.model : null,
  };
}

async function evaluateClassifierCall({ endpoint, state, questions, timeoutMs, fetchImpl }) {
  if (typeof fetchImpl !== "function") return { ok: false, error: "no fetch implementation available" };
  const url = typeof endpoint === "string" && endpoint.trim().length > 0 ? endpoint.trim() : CLASSIFIER_DEFAULT_ENDPOINT;
  if (!isDecisionApiEndpointValid(url)) return { ok: false, error: "the classifier endpoint is not an http(s) URL" };
  const built = buildClassifierRequest({ state, questions });
  if (!built.ok) return built;
  const criteria = questions[built.id]?.criteria ?? null;
  const startedAt = Date.now();
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(built.body),
      signal: controller ? controller.signal : undefined,
    });
    if (!response || typeof response.status !== "number" || response.status < 200 || response.status >= 300) {
      return { ok: false, error: `the classifier answered HTTP ${response?.status ?? "unknown"}` };
    }
    const parsed = parseClassifierResponse(await response.json(), built.id, criteria);
    if (!parsed.ok) return parsed;
    return { ok: true, answers: parsed.answers, model: parsed.model, latencyMs: Date.now() - startedAt };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, error: aborted ? `the classifier timed out after ${timeoutMs}ms` : `the classifier call failed: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// The wire shape decides the transport, never the provider id: every
// labels-schema provider shares the classifier path, every jev-schema
// provider shares the typed path. New providers inherit both by adding
// one registry row.
export function providerSchema(provider) {
  return providerById(normalizeDecisionProvider(provider))?.schema ?? "jev";
}

// Explicit probe, one per provider shape: a fixed defect question answered
// the provider's native way. Compares round-trip + latency, never quality.
export function buildProbeCall(provider) {
  const state = "The login button does nothing when clicked.";
  if (providerSchema(provider) === "labels") {
    return { state, questions: { defect: { type: "choice", instructions: "Does this message report a defect?", criteria: { defect: "A message reporting a broken behavior", other: "Anything else" } } } };
  }
  return { state, questions: { defect: { type: "noul", instructions: "Does this message report a defect?" } } };
}

// One evaluated call. Returns a result object on every path — network
// errors, timeouts, non-2xx statuses, and malformed bodies all arrive as
// { ok: false, error } so the caller falls back to built-in rules.
export async function evaluateDecisionCall({ provider = "jev", endpoint, apiKey, model, state, questions, timeoutMs = DECISION_API_TIMEOUT_MS, fetchImpl = globalThis.fetch }) {
  if (providerSchema(provider) === "labels") {
    return evaluateClassifierCall({ endpoint, state, questions, timeoutMs, fetchImpl });
  }
  if (typeof fetchImpl !== "function") return { ok: false, error: "no fetch implementation available" };
  if (!isDecisionApiEndpointValid(endpoint)) return { ok: false, error: "the Decision API endpoint is not an http(s) URL" };
  const needsKey = providerRequiresKey(provider);
  if (needsKey && (typeof apiKey !== "string" || apiKey.length === 0)) return { ok: false, error: "the Decision API has no key (settings or DECISION_API_KEY)" };
  const headers = { "Content-Type": "application/json" };
  if (typeof apiKey === "string" && apiKey.length > 0) headers.Authorization = `Bearer ${apiKey}`;
  const startedAt = Date.now();
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(String(endpoint).trim(), {
      method: "POST",
      headers,
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
