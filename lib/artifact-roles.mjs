/**
 * Deliverable vs evidence roles for card artifacts (pure, no I/O).
 *
 * Machine receipts (Stelow's portable `audit-trail.md`, the recon
 * `recon-receipt.json`) are real audit value — they stay in the run bundle,
 * the manifest, and the commit trailer — but they are not deliverables and
 * must not inflate the file count or sit unlabeled beside specs. The host's
 * `audit.md` stays a deliverable: it records acceptance criteria, tests,
 * and checkout for humans. Unregistered strays stay visible as-is; this
 * module only separates the two known machine receipts.
 */

const EVIDENCE_BASENAMES = new Set(["audit-trail.md", "recon-receipt.json"]);

function basenameOf(path) {
  return String(path ?? "").replace(/\\/g, "/").split("/").pop() ?? "";
}

/** True for the recon capability receipt — debug context, never a file row. */
export function isReconReceiptArtifact(artifact) {
  if (!artifact || typeof artifact !== "object") return false;
  if (typeof artifact.path !== "string") return false;
  return basenameOf(artifact.path) === "recon-receipt.json";
}

/** "evidence" for the two machine receipts, "deliverable" for everything else. */
export function artifactRole(artifact) {
  if (!artifact || typeof artifact !== "object") return "deliverable";
  if (artifact.kind === "audit-trail") return "evidence";
  if (EVIDENCE_BASENAMES.has(basenameOf(artifact.path))) return "evidence";
  return "deliverable";
}

/** Partition an artifact list into { deliverables, evidence } (stable order). */
export function splitArtifactsByRole(artifacts) {
  const deliverables = [];
  const evidence = [];
  for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
    (artifactRole(artifact) === "evidence" ? evidence : deliverables).push(artifact);
  }
  return { deliverables, evidence };
}

/**
 * The audit-trail file list starts collapsed and auto-opens only when the
 * trail needs attention (stale, missing, refused…). A verified trail stays
 * one quiet line — the badge above already says verified.
 */
export function shouldAutoOpenEvidence(trailState) {
  return typeof trailState === "string" && trailState !== "verified";
}
