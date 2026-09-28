import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { artifactRole, splitArtifactsByRole, artifactRoleCounts } from "../lib/artifact-roles.mjs";

// Machine receipts are evidence, never deliverables: the portable
// audit-trail.md and the recon-receipt.json stay in the bundle and the
// trailer, but must not inflate the file count or sit unlabeled. The
// host's audit.md stays a deliverable — it records acceptance criteria,
// tests, and checkout for humans.
assert.equal(artifactRole({ kind: "audit-trail", path: "x/audit-trail.md" }), "evidence", "audit-trail kind reads evidence");
assert.equal(artifactRole({ kind: "document", path: ".stelow/2026-01-01/abc/audit-trail.md" }), "evidence", "audit-trail basename reads evidence whatever the kind");
assert.equal(artifactRole({ kind: "document", path: ".stelow/2026-01-01/abc/context/recon-receipt.json" }), "evidence", "recon receipt reads evidence");
assert.equal(artifactRole({ kind: "document", path: "x/audit.md" }), "deliverable", "the host audit receipt stays a deliverable");
assert.equal(artifactRole({ kind: "document", path: "x\\context\\recon-receipt.json" }), "evidence", "windows separators read evidence too");
assert.equal(artifactRole({ kind: "document", path: "x/spec-tech_v1.md" }), "deliverable", "specs stay deliverables");
assert.equal(artifactRole({ kind: "unregistered", path: "x/notes.md" }), "deliverable", "unregistered strays stay visible as deliverables");
assert.equal(artifactRole(null), "deliverable", "junk never hides");
assert.equal(artifactRole({ kind: "document", path: null }), "deliverable", "missing path never hides");

const { deliverables, evidence } = splitArtifactsByRole([
  { kind: "document", path: "spec-tech_v1.md" },
  { kind: "audit-trail", path: "audit-trail.md" },
  { kind: "document", path: "audit.md" },
]);
assert.deepEqual(deliverables.map((entry) => entry.path), ["spec-tech_v1.md", "audit.md"], "deliverables keep order minus evidence");
assert.deepEqual(evidence.map((entry) => entry.path), ["audit-trail.md"], "evidence partitions out");
assert.deepEqual(splitArtifactsByRole(null), { deliverables: [], evidence: [] }, "junk partitions empty");

// The number a card section states to the reader. This is the only place
// "how many files did this card produce" becomes a claim, and it is the claim
// Explore got wrong: it counted everything it received, so a card with two
// deliverables and one receipt said "3 files".
const mixed = [
  { kind: "document", path: "spec-tech_v1.md" },
  { kind: "audit-trail", path: "audit-trail.md" },
  { kind: "document", path: "audit.md" },
  { kind: "document", path: "context/recon-receipt.json" },
];
assert.deepEqual(artifactRoleCounts(mixed), { deliverables: 2, evidence: 2 }, "a receipt is never counted as a produced file");
assert.deepEqual(artifactRoleCounts([]), { deliverables: 0, evidence: 0 }, "no artifacts means no claim");
assert.deepEqual(artifactRoleCounts(null), { deliverables: 0, evidence: 0 }, "junk counts zero rather than throwing");
assert.deepEqual(
  artifactRoleCounts([{ kind: "document", path: "a.md" }]),
  { deliverables: 1, evidence: 0 },
  "a deliverables-only list still counts",
);
assert.equal(
  mixed.length,
  artifactRoleCounts(mixed).deliverables + artifactRoleCounts(mixed).evidence,
  "the counts account for every artifact received, so none is silently dropped",
);

// Wiring pins (topology, not copy).
//
// The role is stamped by the card detail and carried by the contract, but for a
// long time nothing applied it where it became visible: Build re-implemented the
// filter inline (twice, in one file) and rendered a bespoke <section> with a
// hand-written heading, while Explore passed every artifact straight through, so
// a machine receipt counted as a file the card had produced. The classification
// existed, travelled, and was dropped at the last step.
//
// These pins therefore constrain WHERE the rule is applied — exactly one place —
// rather than the prose around it. Reintroducing an inline filter, mounting the
// inventory twice, or bypassing the shared disclosure each fail here.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = [
  readFileSync(join(root, "server/plugin-runtime.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/card-detail-artifacts.ts"), "utf8"),
].join("\n");
const contract = readFileSync(join(root, "server/card-detail-rpc-contract.ts"), "utf8");
assert.match(runtime, /artifactRole\(/, "card detail stamps the artifact role");
assert.match(contract, /role: z\.enum\(\["deliverable", "evidence"\]\)/, "the card detail contract carries the role");

const inventory = readFileSync(join(root, "components/artifacts/artifact-inventory.tsx"), "utf8");
assert.match(inventory, /splitArtifactsByRole\(artifacts\)/, "the shared inventory applies the role rule");
assert.match(inventory, /<DisclosureSection[\s\S]{0,200}Machine receipts/, "receipts render in the shared disclosure family");
assert.doesNotMatch(inventory, /<section\b/, "the inventory invents no section of its own");

// One rule, one mount: no track may re-implement the filter or split the
// inventory by hand, and the number each surface states comes from the shared
// count rather than from whatever it was handed.
for (const file of ["components/detail/build-detail-progress.tsx", "components/detail/explore-detail-content.tsx"]) {
  const source = readFileSync(join(root, file), "utf8");
  assert.doesNotMatch(
    source,
    /role\s*[!=]==?\s*"evidence"/,
    `${file} must not re-implement the role rule — it lives in lib/artifact-roles.mjs`,
  );
  assert.doesNotMatch(
    source,
    /artifacts\.length/,
    `${file} must not state a count from the raw list — a receipt would be counted as a produced file`,
  );
  assert.equal((source.match(/<ArtifactGroups/g) ?? []).length, 1, `${file} mounts the inventory once`);
  assert.match(source, /artifactRoleCounts\(/, `${file} reads the shared count the card states`);
}

console.log("artifact roles test ok: receipt roles, partition, counts, one rule, one mount");
