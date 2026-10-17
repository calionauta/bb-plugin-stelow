import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasWorkspaceSource, recoveryDisposition, recoveryMessage, reportedCheckoutPaths, reportedRecoveryEvidence } from "../lib/workspace-recovery.mjs";

const root = join(import.meta.dirname, "..");
const app = readFileSync(join(root, "app.tsx"), "utf8");
const body = readFileSync(join(root, "components/detail/build-detail-body.tsx"), "utf8");
const reviewTools = readFileSync(join(root, "components/detail/build-detail-review-tools.tsx"), "utf8");
const recovery = readFileSync(join(root, "components/detail/build-recovery.tsx"), "utf8");
const panelRoute = readFileSync(join(root, "components/app-support/panel-route.tsx"), "utf8");

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

assert.match(reviewTools, /import \{ WorkspaceRecoveryPanel \} from "\.\/build-recovery";/, "Build review tools import one recovery presentation feature");
assert.doesNotMatch(
  recovery,
  /useRpc|rpc\.call|useBuildDetailLifecycle/,
  "the recovery panel stays a presentation boundary with no host or lifecycle ownership",
);
assert.match(
  reviewTools,
  /card\.status === "completed"[\s\S]*card\.workspaceKind === "exploratory"[\s\S]*<BuildRecoveryContent/,
  "only completed exploratory Build publications mount recovery controls",
);
assert.doesNotMatch(`${app}\n${body}`, /function WorkspaceRecoveryPanel/, "Build detail no longer owns recovery presentation markup");
// The recovery controls are clicked, not grepped: the panel is a pure-props
// presentation feature, so a test can mount it and press each control. A JSX
// prop pin cannot tell a live handler from one wired to a no-op, and it fails
// on a rename while the panel still works.
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(pathToFileURL(new URL("./register-tsx.mjs", import.meta.url).pathname), import.meta.url);
await import("./dom-setup.mjs");
const { createElement: h } = await import("react");
const { render, screen, fireEvent, cleanup } = await import("@testing-library/react");
const { WorkspaceRecoveryPanel } = await import("../components/detail/build-recovery.tsx");

const candidate = {
  projectId: "proj_reported",
  projectName: "Reported checkout",
  path: "/home/deploy/repos/app",
  branch: "main",
  headSha: "a".repeat(40),
  changedFiles: 3,
  evidence: "The worker reported writing here.",
};
const recoveryData = (overrides = {}) => ({
  kind: "promote",
  message: "This workspace has source material.",
  candidates: [candidate],
  looseEvidence: [{ path: "/tmp/worker.patch", kind: "patch" }],
  recovery: null,
  audit: null,
  ...overrides,
});

function mountPanel(recovery, loading = false) {
  const fired = [];
  const tree = render(h(WorkspaceRecoveryPanel, {
    recovery,
    loading,
    onRefresh: () => fired.push("refresh"),
    onPromote: () => fired.push("promote"),
    onAttach: (projectId) => fired.push(`attach:${projectId}`),
    onCreateAudit: () => fired.push("create-audit"),
    onOpenAudit: (cardId) => fired.push(`open-audit:${cardId}`),
  }));
  return { fired, tree };
}

const promoting = mountPanel(recoveryData());
fireEvent.click(screen.getByRole("button", { name: "Re-check evidence" }));
assert.deepEqual(promoting.fired, ["refresh"], "re-check reaches the host read");
fireEvent.click(screen.getByRole("button", { name: /Turn this source workspace into a project/ }));
assert.deepEqual(promoting.fired, ["refresh", "promote"], "promotion is still a decision the reader makes");
fireEvent.click(screen.getByRole("button", { name: /Attach for audit trail/ }));
assert.deepEqual(promoting.fired, ["refresh", "promote", "attach:proj_reported"], "attach names the exact candidate it was pressed on");
assert.ok(screen.getByText(/\/tmp\/worker\.patch/), "loose evidence stays visible without becoming a write target");
assert.equal(
  screen.queryByRole("button", { name: "Create recovery audit" }),
  null,
  "attachment controls stay exclusive to attached recovery",
);
cleanup();

const attachedOpen = mountPanel(recoveryData({
  kind: "attached",
  recovery: { projectId: "proj_reported", projectName: "Reported checkout", path: "/home/deploy/repos/app", attachedAt: 0 },
}));
fireEvent.click(screen.getByRole("button", { name: "Create recovery audit" }));
assert.deepEqual(attachedOpen.fired, ["create-audit"], "an attachment with no audit yet offers to create one");
cleanup();

const attachedWithAudit = mountPanel(recoveryData({
  kind: "attached",
  recovery: { projectId: "proj_reported", projectName: "Reported checkout", path: "/home/deploy/repos/app", attachedAt: 0 },
  audit: { cardId: "card_audit", cardName: "Recovery audit", createdAt: 0 },
}));
fireEvent.click(screen.getByRole("button", { name: "Open recovery audit" }));
assert.deepEqual(attachedWithAudit.fired, ["open-audit:card_audit"], "an existing audit opens by the id the navigation needs");
cleanup();

mountPanel(null, true);
assert.equal(screen.getByRole("button", { name: "Checking…" }).disabled, true, "a read in flight cannot be re-issued");
cleanup();
const recoveryPanelCall = reviewTools.match(/<WorkspaceRecoveryPanel[\s\S]*?\/>/)?.[0];
assert.ok(recoveryPanelCall, "Build review tools mount the recovery presentation feature");
for (const [prop, wiring] of [
  ["recovery", /recovery=\{lifecycle\.workspaceRecovery\}/],
  ["loading", /loading=\{lifecycle\.workspaceRecoveryLoading \|\| lifecycle\.creatingRecoveryAudit\}/],
  ["refresh", /onRefresh=\{\(\) => void lifecycle\.loadWorkspaceRecovery\(\)\}/],
  ["promote", /onPromote=\{\(\) => \{\s*lifecycle\.setPromoteName\(card\.displayName\);\s*lifecycle\.setPromoteOpen\(true\);/],
  ["attach", /onAttach=\{lifecycle\.setRecoveryAttachProjectId\}/],
  ["create audit", /onCreateAudit=\{\(\) => void lifecycle\.doCreateRecoveryAudit\(\)\}/],
  ["open audit", /onOpenAudit=\{view\.onOpenRecoveryAudit\}/],
]) {
  assert.match(recoveryPanelCall, wiring, `recovery ${prop} action remains wired after extraction`);
}
assert.equal(
  (app.match(/goToCard\(/g) ?? []).length
  + (panelRoute.match(/goToCard\(/g) ?? []).length,
  2,
  "both Build detail entry points route recovery audits back to the Build track",
);

console.log("workspace recovery test ok: promotion and attachment are mutually exclusive evidence-led paths");
