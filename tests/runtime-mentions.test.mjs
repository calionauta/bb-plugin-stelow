import assert from "node:assert/strict";
import test from "node:test";
import { registerMentionProviders } from "../server/runtime/mentions.ts";

function harness() {
  const providers = new Map();
  const boardCalls = [];
  const rows = [
    { id: "card-1", display_name: "Exploratory idea", name: "idea", stage: "research", status: "pending", intent: "investigate", dir_hash: "hash-1" },
    { id: "card-2", display_name: "Archived", name: "old", stage: "audit", status: "archived", intent: "feature", dir_hash: null },
  ];
  const db = {
    prepare(sql) {
      return {
        all: (...values) => sql.includes("project_id = ?")
          ? rows.filter((row) => row.status !== "archived" && values[0] === "project-1")
          : rows.filter((row) => row.status !== "archived"),
        get: (...values) => values[0] === "card-1" || values[0] === "hash-1" ? rows[0] : undefined,
      };
    },
  };
  const bb = {
    sdk: {
      projects: {
        list: async () => [{ id: "project-1" }],
        get: async () => ({ sources: [{ isDefault: true, path: "/repo" }] }),
      },
      files: { list: async () => ({ files: [{ path: "src/server.ts" }, { path: "README.md" }] }) },
    },
    ui: {
      registerMentionProvider: (provider) => providers.set(provider.id, provider),
    },
  };
  const loadBoard = async (projectId) => {
    boardCalls.push(projectId);
    return {
      workflows: [{
        id: "workflow-1",
        name: "Build workflow",
        stage: "execution",
        status: "in-progress",
        appetite: "Core",
        reviewMode: "Auto",
        scopes: [{ id: "scope-1", status: "pending" }],
      }],
    };
  };
  registerMentionProviders(bb, { db, loadBoard });
  return { providers, boardCalls };
}

test("mention registration publishes exactly the workflow and file providers", () => {
  const { providers } = harness();
  assert.deepEqual([...providers.keys()], ["workflow", "file"]);
  assert.deepEqual(
    [...providers.values()].map(({ id, label, triggers }) => ({ id, label, triggers })),
    [
      { id: "workflow", label: "Stelow workflows", triggers: ["@"] },
      { id: "file", label: "Workspace files", triggers: ["@"] },
    ],
  );
});

test("workflow mentions include exploratory cards when the project board misses them", async () => {
  const { providers, boardCalls } = harness();
  const result = await providers.get("workflow").search({ query: "idea", projectId: "project-1" });
  assert.deepEqual(result, [{
    id: "hash-1",
    title: "Exploratory idea",
    subtitle: "research · pending · investigate",
  }]);
  assert.deepEqual(boardCalls, ["project-1"]);
});

test("workflow and file mention resolvers return the canonical context", async () => {
  const { providers } = harness();
  const workflow = await providers.get("workflow").resolve("workflow-1");
  assert.match(workflow.context, /Stelow workflow Build workflow/);
  assert.match(workflow.context, /scope-1:pending/);
  const card = await providers.get("workflow").resolve("card-1");
  assert.match(card.context, /Stelow card Exploratory idea/);
  const file = await providers.get("file").search({ query: "server", projectId: "project-1" });
  assert.deepEqual(file[0], { id: "src/server.ts", title: "server.ts", subtitle: "src/server.ts" });
  assert.deepEqual(await providers.get("file").resolve("src/server.ts"), { context: "Workspace file: src/server.ts" });
});

console.log("runtime mentions test ok: board/card fallback, workflow context, and file context");
