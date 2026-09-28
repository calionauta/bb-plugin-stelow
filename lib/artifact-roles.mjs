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
 * The counts a card section may claim, derived from the same rule that
 * partitions the list.
 *
 * Two surfaces state a number to the reader — the Artifacts hint on Build and on
 * Explore — and they are the only place where "how many files did this card
 * produce" becomes a claim. A receipt counted there inflates it. Routing both
 * through one function means the two cannot drift, and it is testable without a
 * renderer: the earlier state had each surface re-deriving the count, and Explore
 * derived it wrongly.
 */
export function artifactRoleCounts(artifacts) {
  const { deliverables, evidence } = splitArtifactsByRole(artifacts);
  return { deliverables: deliverables.length, evidence: evidence.length };
}
