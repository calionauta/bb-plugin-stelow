import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasWorkspaceSource, recoveryDisposition, recoveryMessage, reportedCheckoutPaths, reportedRecoveryEvidence } from "../lib/workspace-recovery.mjs";

const root = join(import.meta.dirname, "..");
const app = readFileSync(join(root, "app.tsx"), "utf8");
const recovery = readFileSync(join(root, "components/detail/build-recovery.tsx"), "utf8");

assert.deepEqual(reportedCheckoutPaths("Changes are uncommitted in `/home/deploy/repos/bb-plugin-stelow`."), ["/home/deploy/repos/bb-plugin-stelow"], "an explicit worker report yields a candidate path");
assert.deepEqual(reportedCheckoutPaths("I edited /tmp/guess without reporting it as a checkout."), [], "bare paths never become recovery candidates");
assert.deepEqual(reportedRecoveryEvidence("Saved /tmp/worker.patch and /work/loose-folder for review."), [{ path: "/tmp/worker.patch", kind: "patch" }, { path: "/work/loose-folder", kind: "folder" }], "loose paths become visible evidence without becoming write targets");
assert.equal(recoveryDisposition({ workspaceIsGit: false, hasWorkspaceSource: false, candidates: [{}], attached: false }), "external-project");
assert.equal(recoveryDisposition({ workspaceIsGit: true, hasWorkspaceSource: false, candidates: [], attached: false }), "promote");
assert.equal(recoveryDisposition({ workspaceIsGit: false, hasWorkspaceSource: false, candidates: [{}, {}], attached: false }), "ambiguous");
assert.equal(recoveryDisposition({ workspaceIsGit: false, hasWorkspaceSource: false, candidates: [], attached: false }), "documents-only");
assert.match(recoveryMessage("external-project"), /Review/, "recovery asks for review, never auto-attachment");

// The real card_qnszca09 workspace: skills/, .stelow/, stelow.json — all
// Stelow scaffolding. Counting it as source would hide the reported-checkout
// path behind a "promote" answer that promotes an empty folder.
const seededOnly = [{ name: "skills", isDirectory: true }, { name: ".stelow", isDirectory: true }, { name: "stelow.json", isDirectory: false }];
assert.equal(hasWorkspaceSource(seededOnly), false, "Stelow's own scaffolding is never source material");
assert.equal(recoveryDisposition({ workspaceIsGit: false, hasWorkspaceSource: hasWorkspaceSource(seededOnly), candidates: [{}], attached: false }), "external-project", "a seeded-only workspace offers the reported checkout, not promotion");
assert.equal(hasWorkspaceSource([...seededOnly, { name: "src", isDirectory: true }]), true, "a directory Stelow did not create is real work");
assert.equal(hasWorkspaceSource([{ name: "app.tsx", isDirectory: false }]), true, "a real source file makes the workspace promotable");
assert.equal(hasWorkspaceSource([{ name: "stelow.json", isDirectory: false }]), false, "Stelow's tracking file is scaffolding, not source");
assert.equal(hasWorkspaceSource([{ name: "notes.md", isDirectory: false }]), true, "a written source document is real work");
assert.equal(hasWorkspaceSource([{ name: "data", isDirectory: true }, { name: "node_modules", isDirectory: true }]), false, "synced data and installed modules are not the user's work");
assert.equal(hasWorkspaceSource([]), false);
assert.equal(hasWorkspaceSource(null), false);

assert.match(app, /import \{ WorkspaceRecoveryPanel \} from "\.\/components\/detail\/build-recovery";/, "CardDetailBody imports the recovery presentation feature");
assert.match(app, /<WorkspaceRecoveryPanel[\s\S]*onCreateAudit=\{\(\) => void doCreateRecoveryAudit\(\)\}[\s\S]*onOpenAudit=\{\(auditCardId\) => goToCard/, "recovery actions remain wired to lifecycle and audit navigation");
assert.doesNotMatch(app, /function WorkspaceRecoveryPanel/, "CardDetailBody no longer owns recovery presentation markup");
assert.match(recovery, /recovery\.kind === "attached" && recovery\.recovery/, "attached recovery exposes the audit handoff");
assert.match(recovery, /recovery\.looseEvidence\.map/, "loose evidence remains visible without becoming an automatic destination");

console.log("workspace recovery test ok: promotion and attachment are mutually exclusive evidence-led paths");
