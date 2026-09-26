import assert from "node:assert/strict";
import test from "node:test";
import { createResearchArtifactRuntime } from "../server/runtime/research-artifacts.ts";

const REAL_CONTENT = `# Pricing analysis\n\n${"A concrete pricing finding with evidence. ".repeat(12)}`;

function card(overrides = {}) {
  return {
    id: "card-1",
    project_id: "project-1",
    name: "research-card",
    display_name: "Research card",
    prompt: "Research pricing",
    intent: "investigate",
    status: "in-progress",
    stage: "research",
    activity: "idle",
    worker_thread_id: "thread-1",
    worker_preset_id: null,
    preset_restart_pending: 0,
    dir_hash: "hash-1",
    auto_continue_count: null,
    auto_continue_stage: null,
    spawn_retry_count: null,
    spawn_retry_thread: null,
    attachments: "[]",
    workspace_kind: "project",
    workspace_path: null,
    workspace_host_id: null,
    kind: "research",
    research_strategy: "pricing",
    research_strategies: null,
    explore_stage: null,
    last_error: null,
    last_assistant_text: null,
    last_idle_at: null,
    environment_label: null,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function harness(files = {}, overrides = {}) {
  const reads = [];
  const bb = {
    sdk: {
      files: {
        read: async ({ path }) => {
          reads.push(path);
          if (!(path in files)) throw new Error(`missing ${path}`);
          return { content: files[path] };
        },
      },
    },
  };
  const runtime = createResearchArtifactRuntime({
    bb,
    cardWorkspace: async () => ({ path: "/repo", hostId: "host-1" }),
    workflowStateDir: async () => "/repo/.stelow/2026-09-24/hash-1",
    strategyRounds: () => [{ id: "pricing", at: "2026-09-24T00:00:00Z", file: "rounds/pricing-r1-20260924-0000.md" }],
    joinPath: (root, relative) => `${root}/${relative}`,
    workspaceRelative: (root, path) => path.replace(`${root}/`, ""),
    errors: { workspaceUnavailable: "Workspace is unavailable." },
    ...overrides,
  });
  return { runtime, reads };
}

test("research round projection exposes valid primary output and skips an index mirror", async () => {
  const primary = "/repo/.stelow/2026-09-24/hash-1/rounds/pricing-r1-20260924-0000.md";
  const { runtime } = harness({
    [primary]: REAL_CONTENT,
    "/repo/.stelow/2026-09-24/hash-1/research-index.md": "# Research index\n\n## Opportunities\n",
  });
  const result = await runtime.researchRoundFiles(
    "/repo",
    "host-1",
    "/repo/.stelow/2026-09-24/hash-1",
    [{ id: "pricing", at: "2026-09-24T00:00:00Z", file: ".stelow/2026-09-24/hash-1/rounds/pricing-r1-20260924-0000.md" }],
    false,
  );
  assert.equal(result.rounds[0].status, "ready");
  assert.equal(result.rounds[0].files[0].path, ".stelow/2026-09-24/hash-1/rounds/pricing-r1-20260924-0000.md");
  assert.equal(result.rounds[0].files[0].hostId, "host-1");
});

test("research round projection rejects an index mirror", async () => {
  const index = "# Research index\n\n## Opportunities\n\n- [ ] Something\n";
  const primary = "/repo/.stelow/2026-09-24/hash-1/rounds/pricing-r1-20260924-0000.md";
  const { runtime } = harness({
    [primary]: index,
    "/repo/.stelow/2026-09-24/hash-1/research-index.md": index,
  });
  const result = await runtime.researchRoundFiles(
    "/repo",
    "host-1",
    "/repo/.stelow/2026-09-24/hash-1",
    [{ id: "pricing", at: "2026-09-24T00:00:00Z", file: ".stelow/2026-09-24/hash-1/rounds/pricing-r1-20260924-0000.md" }],
    false,
  );
  assert.equal(result.rounds[0].status, "missing");
  assert.deepEqual(result.rounds[0].files, []);
});

test("explore artifact dispatch resolves workspace state before checking the stage", async () => {
  let workspaceCalls = 0;
  const { runtime } = harness({}, {
    cardWorkspace: async () => {
      workspaceCalls += 1;
      return { path: "/repo", hostId: "host-1" };
    },
  });
  const result = await runtime.exploreArtifact(card({ kind: "explore", explore_stage: null }));
  assert.deepEqual(result, { ready: false, fingerprint: null, failures: [] });
  assert.equal(workspaceCalls, 1);
});

test("non-research readiness refuses without reading workspace files", async () => {
  const { runtime, reads } = harness({});
  const result = await runtime.researchReadiness(card({ kind: "explore" }));
  assert.deepEqual(result, { ready: false, fingerprint: null, evidence: "verified", invalid: [] });
  assert.deepEqual(reads, []);
});

test("research index and explore artifact reads report missing state without throwing", async () => {
  const { runtime } = harness({
    "/repo/.stelow/2026-09-24/hash-1/research-index.md": "# Research index\n\n## Opportunities\n",
    "/repo/.stelow/2026-09-24/hash-1/explore-shape-up.md": `# Shape Up\n\n${"A complete stage deliverable. ".repeat(12)}`,
  });
  const index = await runtime.readResearchIndex(card());
  assert.equal(index.ok, true);
  assert.equal(index.display, ".stelow/2026-09-24/hash-1/research-index.md");

  const explore = await runtime.exploreArtifact(card({ kind: "explore", explore_stage: "shape-up" }));
  assert.equal(explore.ready, false, "an unregistered stage contract still fails closed");
  const missing = await runtime.readResearchIndex(card({ dir_hash: null }));
  assert.deepEqual(missing, { ok: false, error: "No workflow state for this research yet." });
});

console.log("runtime research artifacts test ok: round projection, index ownership, and explore refusal");
