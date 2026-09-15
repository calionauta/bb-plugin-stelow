import assert from "node:assert/strict";
import { hasWorkspaceSource, recoveryDisposition, recoveryMessage, reportedCheckoutPaths } from "../lib/workspace-recovery.mjs";

assert.deepEqual(reportedCheckoutPaths("Changes are uncommitted in `/home/deploy/repos/bb-plugin-stelow`."), ["/home/deploy/repos/bb-plugin-stelow"], "an explicit worker report yields a candidate path");
assert.deepEqual(reportedCheckoutPaths("I edited /tmp/guess without reporting it as a checkout."), [], "bare paths never become recovery candidates");
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

console.log("workspace recovery test ok: promotion and attachment are mutually exclusive evidence-led paths");
