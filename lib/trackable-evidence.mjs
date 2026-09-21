/**
 * Trackable evidence projection (pure, no I/O, kind-blind).
 *
 * Every kind surfaces evidence through the same shape: an optional sidecar
 * contract file (acceptance_criteria, verify_commands, target_files),
 * an inline record mirror (verified, counts, timestamps), live-claim
 * observation, and k8s-style conditions. Which of these a kind uses comes
 * from its row in lib/trackable-contracts.mjs (`contractFile`,
 * `recordInline`) — a kind without a sidecar never warns for lacking one.
 * Callers do I/O and fail open on unreadable files; missing evidence is a
 * condition, never a crash.
 */
import { buildCondition, isActiveStatus, isDoneStatus } from "./trackables.mjs";
import { contractForTrackable } from "./trackable-contracts.mjs";
import { edgesOf, openChildren, openDependencies } from "./trackable-relations.mjs";

function strArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()) : [];
}

function cleanSegment(value) {
  const segment = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_-]{1,80}$/.test(segment) ? segment : null;
}

function cleanDir(value) {
  return typeof value === "string" && value ? value.replace(/\/$/, "") : null;
}

/**
 * Sidecar contract path for any kind: `<stateRelDir>/<template>` with
 * `{id}` (and `{parentId}`) filled from validated segments. Null when the
 * kind declares no sidecar, on bad ids, or on unfilled placeholders.
 */
export function contractRelPath(stateRelDir, kind, trackableId, parentId = null) {
  const base = cleanDir(stateRelDir);
  const definition = contractForTrackable(kind);
  const template = definition && typeof definition.contractFile === "string" ? definition.contractFile : null;
  if (!base || !template) return null;
  const id = cleanSegment(trackableId);
  if (!id) return null;
  const parent = template.includes("{parentId}") ? cleanSegment(parentId) : "";
  if (template.includes("{parentId}") && parent === null) return null;
  const filled = template.replace("{id}", id).replace("{parentId}", parent ?? "");
  if (filled.includes("{") || filled.includes("}") || filled.includes("..")) return null;
  return `${base}/${filled}`;
}

/**
 * Parse a sidecar contract body into { acceptanceCriteria, verifyCommands,
 * targetFiles }. Null on any misshape — callers treat a missing contract
 * as a condition, not an error.
 */
export function parseEvidenceContract(content) {
  let parsed;
  try {
    parsed = typeof content === "string" ? JSON.parse(content) : null;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const acceptanceCriteria = strArray(parsed.acceptance_criteria ?? parsed.acceptanceCriteria);
  const verifyCommands = strArray(parsed.verify_commands ?? parsed.verifyCommands);
  const targetFiles = strArray(parsed.target_files ?? parsed.targetFiles);
  if (acceptanceCriteria.length === 0 && verifyCommands.length === 0 && targetFiles.length === 0) return null;
  return { acceptanceCriteria, verifyCommands, targetFiles };
}

/**
 * Sanitize an inline record mirror into host shape ({ verified,
 * filesCount, commandsCount, completedAt, startedAt, suggestedCommit }).
 * Null when absent — a trackable without a record is unobserved, not failed.
 */
export function sanitizeEvidenceRecord(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  if (typeof raw.verified === "boolean") out.verified = raw.verified;
  if (typeof raw.files_count === "number") out.filesCount = raw.files_count;
  if (typeof raw.commands_count === "number") out.commandsCount = raw.commands_count;
  if (typeof raw.completed_at === "string") out.completedAt = raw.completed_at;
  if (typeof raw.started_at === "string") out.startedAt = raw.started_at;
  if (typeof raw.suggested_commit === "string") out.suggestedCommit = raw.suggested_commit;
  return Object.keys(out).length > 0 ? out : null;
}

function displayName(entry) {
  if (entry && typeof entry === "object") {
    if (typeof entry.name === "string" && entry.name) return entry.name;
    if (typeof entry.id === "string" && entry.id) return entry.id;
  }
  return "trackable";
}

/**
 * Conditions for one registry entry, from its status against its evidence
 * and relations. Finished entries carry close-out proof; open entries
 * carry ordering and honesty signals; satisfied relations stay silent.
 */
export function evidenceConditions({ entry, registry = new Map(), claimed = null, claimLapsed = false } = {}) {
  const conditions = [];
  if (!entry || typeof entry !== "object") return conditions;
  const push = (condition) => { if (condition) conditions.push(condition); };
  const name = displayName(entry);
  const record = entry.record && typeof entry.record === "object" ? entry.record : null;
  const contract = entry.contract && typeof entry.contract === "object" ? entry.contract : null;
  const expectsContract = Boolean(contractForTrackable(entry.kind)?.contractFile);
  if (isDoneStatus(entry.status)) {
    if (record && record.verified !== true) {
      push(buildCondition({
        type: "UnverifiedClose",
        reason: "RecordUnverified",
        message: `${name} is done but its Record is not verified — complete the verification checklist and re-run the verify commands, then close again.`,
      }));
    }
    if (!record) {
      push(buildCondition({
        type: "NoRecord",
        reason: "RecordMissing",
        message: `${name} is done with no Record — its close cannot be audit-checked.`,
      }));
    }
    if (expectsContract && (!contract || !Array.isArray(contract.acceptanceCriteria) || contract.acceptanceCriteria.length === 0)) {
      push(buildCondition({
        type: "ContractMissing",
        reason: "ContractMissing",
        message: `${name} is done with no contract — its acceptance criteria live only in prose.`,
      }));
    }
    const open = openChildren(entry, registry);
    if (open.length > 0) {
      push(buildCondition({
        type: "OpenChildrenOnClose",
        reason: "ChildrenOpen",
        message: `${name} is done with ${open.length} open child(ren) — close each before closing it: ${open.slice(0, 3).map((child) => child.name ?? child.id).join("; ")}${open.length > 3 ? "…" : ""}.`,
      }));
    }
    return conditions;
  }
  const openDeps = openDependencies(entry, registry, (status) => isDoneStatus(status));
  if (openDeps.length > 0) {
    push(buildCondition({
      type: "BlockedByOpen",
      reason: "DependenciesOpen",
      message: `${name} waits on unfinished trackable(s): ${openDeps.join(", ")} — start them first.`,
    }));
  }
  const dangling = edgesOf(entry).filter((dep) => !(registry instanceof Map) || !registry.has(dep));
  if (dangling.length > 0) {
    push(buildCondition({
      type: "DanglingDependency",
      reason: "UnknownTrackables",
      message: `${name} references unknown trackable(s): ${dangling.join(", ")}.`,
    }));
  }
  const started = (typeof entry.startedAt === "string" && entry.startedAt)
    || (record && typeof record.startedAt === "string" && record.startedAt);
  if (isActiveStatus(entry.status) && claimed === false && !started) {
    push(buildCondition({
      type: claimLapsed ? "ClaimLapsed" : "UnclaimedExecution",
      reason: claimLapsed ? "LeaseExpired" : "NoObservableFooting",
      message: claimLapsed
        ? `${name} reads in-progress but its file claims lapsed with no renewal — the worker may have stalled. Re-claim and resume, or park the scope.`
        : `${name} reads in-progress with no live claim and no recorded start — claim its scope before executing.`,
    }));
  }
  return conditions;
}
