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
import { buildCondition, isActiveStatus, isDoneStatus, cleanTrackableId } from "./trackables.mjs";
import { contractForTrackable } from "./trackable-contracts.mjs";
import { areaFileRelPath } from "./tracking-paths.mjs";
import { edgesOf, openChildren, openDependencies, buildRegistry } from "./trackable-relations.mjs";

function strArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()) : [];
}

/**
 * Sidecar contract path for any kind: the kind's template from the
 * contracts table (`scopes/{id}.json`), joined through the uniform layout.
 * Null when the kind declares no sidecar, on bad ids, or on unfilled
 * placeholders — path mechanics live in tracking-paths, kind meaning here.
 */
export function contractRelPath(stateRelDir, kind, trackableId, parentId = null) {
  const definition = contractForTrackable(kind);
  const template = definition && typeof definition.contractFile === "string" ? definition.contractFile : null;
  if (!template) return null;
  const id = cleanTrackableId(trackableId);
  if (!id) return null;
  const parent = template.includes("{parentId}") ? cleanTrackableId(parentId) : "";
  if (template.includes("{parentId}") && parent === null) return null;
  return areaFileRelPath(stateRelDir, template.replace("{id}", id).replace("{parentId}", parent ?? ""));
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

/**
 * Enrich tracked entries for card detail: sidecar contracts, live-claim
 * observation, per-entry conditions — for entries AND their nested tasks
 * through the same machine. All I/O is injected (readContract, liveClaims,
 * isLapsed) so the composition is unit-testable with fakes; the server
 * passes the real claims DB and file reader. Missing state dir resolves
 * every entry bare (empty conditions, null claim) — old specs predate
 * contracts, and absence reads absent, never error.
 */
export async function enrichEntriesForDetail({ entries, stateRelDir = null, ownerId = null, liveClaims = [], isLapsed = null, readContract = null, nowMs = Date.now() } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const bare = (entry) => ({
    ...entry,
    tasks: (Array.isArray(entry?.tasks) ? entry.tasks : []).map((task) => ({
      ...task,
      conditions: evidenceConditions({ entry: { ...(task ?? {}), kind: "task" }, registry: buildRegistry(list) }),
    })),
    conditions: [],
    claimed: null,
  });
  if (!stateRelDir) return list.map(bare);
  const registry = buildRegistry(list);
  const live = Array.isArray(liveClaims) ? liveClaims : [];
  const lapsed = typeof isLapsed === "function" ? isLapsed : () => false;
  const read = typeof readContract === "function" ? readContract : async () => null;
  return await Promise.all(list.map(async (entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const rel = contractRelPath(stateRelDir, entry.kind ?? "scope", entry.id);
    const contract = rel ? parseEvidenceContract(await read(rel).catch(() => null)) : null;
    const targets = Array.isArray(entry.targetFiles) ? entry.targetFiles.filter((file) => typeof file === "string") : [];
    const mine = live.filter((claim) => claim && typeof claim === "object"
      && claim.card_id === ownerId && claim.expires_at > nowMs
      && (claim.scope === entry.id || targets.includes(claim.file_path)));
    const claimed = targets.length > 0 || mine.length > 0 ? mine.length > 0 : null;
    const withContract = contract ? { ...entry, contract } : entry;
    const withTasks = {
      ...withContract,
      tasks: (Array.isArray(withContract.tasks) ? withContract.tasks : []).map((task) => ({
        ...task,
        conditions: evidenceConditions({ entry: { ...(task && typeof task === "object" ? task : {}), kind: "task" }, registry }),
      })),
    };
    return {
      ...withTasks,
      conditions: evidenceConditions({ entry: withTasks, registry, claimed, claimLapsed: claimed === false && lapsed(entry) }),
      claimed,
    };
  }));
}
