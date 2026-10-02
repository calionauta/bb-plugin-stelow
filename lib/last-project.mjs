import { STORAGE_KEYS } from "./panel-storage.mjs";

// Last-project memory for the creation dialogs: the project the user picked
// in a NewThreadComposer is remembered per user (one global key) and seeds
// the next open. All storage access is best-effort — a missing, corrupt, or
// unwritable store reads as absent and never throws.

export function readLastProjectId(storage) {
  if (!storage || typeof storage.getItem !== "function") return null;
  try {
    const raw = storage.getItem(STORAGE_KEYS.lastProject);
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function writeLastProjectId(storage, id) {
  if (!storage || typeof storage.setItem !== "function") return;
  if (typeof id !== "string" || id.length === 0) return;
  try {
    storage.setItem(STORAGE_KEYS.lastProject, id);
  } catch {
    // Persistence is convenience; the card creation already succeeded.
  }
}

// The remembered project wins when it still names a known project;
// otherwise the ambient host context wins. Unknown validIds (no list
// available) means no validation — the stored pick still wins.
export function resolveDefaultProjectId(activeId, storedId, validIds) {
  const stored = typeof storedId === "string" && storedId.length > 0 ? storedId : null;
  if (stored && (!Array.isArray(validIds) || validIds.includes(stored))) return stored;
  return typeof activeId === "string" && activeId.length > 0 ? activeId : null;
}

// Persist the project a successful submit actually used. Projectless
// (null/empty) submits remember nothing — the next open falls back to
// the host context instead of a poisoned blank.
export function rememberUsedProject(storage, projectId) {
  writeLastProjectId(storage, projectId);
}

export function browserStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}
