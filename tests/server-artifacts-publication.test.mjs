import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  createArtifactsPublication,
  runPublicationMigrations,
} from "../server/artifacts-publication.ts";

const CARD_ID = "card-1";
const ENVIRONMENT_ID = "env-1";

function availableStatus(overrides = {}) {
  const workingTree = {
    state: "dirty",
    hasUncommittedChanges: true,
    files: [{ path: "server.ts" }],
    ...overrides.workingTree,
  };
  return {
    outcome: "available",
    workspace: {
      branch: {
        currentBranch: "feature/publication",
        defaultBranch: "main",
        ...overrides.branch,
      },
      checkout: {
        kind: "branch",
        branchName: "feature/publication",
        headSha: "1234567890abcdef1234567890abcdef12345678",
        ...overrides.checkout,
      },
      workingTree,
      mergeBase: {
        mergeBaseBranch: "main",
        aheadCount: 1,
        behindCount: 0,
        hasCommittedUnmergedChanges: true,
        ...overrides.mergeBase,
      },
    },
  };
}

function pullRequest(state = "open") {
  return {
    outcome: "available",
    pullRequest: {
      number: 42,
      title: "Publication slice",
      url: "https://github.com/acme/project/pull/42",
      state,
      attention: "none",
      review: { state: "approved" },
      checks: { state: "passing" },
      mergeability: { state: "mergeable" },
    },
  };
}

function harness() {
  const db = new Database(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      workspace_kind TEXT NOT NULL DEFAULT 'project',
      workspace_host_id TEXT
    );
    INSERT INTO cards (id, status) VALUES ('card-1', 'completed');
    INSERT INTO cards (id, status) VALUES ('card-2', 'completed');
  `);
  runPublicationMigrations(db);
  runPublicationMigrations(db);

  const calls = [];
  let status = availableStatus();
  let pullRequestState = pullRequest();
  let terminalOutput = "working";
  let terminalSessions = [];
  let diffResult = { outcome: "not_applicable", message: "No diff fixture." };
  let patchResult = { outcome: "not_applicable", message: "No patch fixture." };
  let id = 0;
  const bb = {
    log: { warn: (message) => calls.push(["warn", message]) },
    sdk: {
      environments: {
        status: async (args) => {
          calls.push(["status", args]);
          return status;
        },
        pullRequest: async (args) => {
          calls.push(["pullRequest", args]);
          return pullRequestState;
        },
        commit: async (args) => {
          calls.push(["commit", args]);
          return { message: "Commit saved.", commitSha: "abcdef1234567890" };
        },
        diffFiles: async (args) => {
          calls.push(["diffFiles", args]);
          return diffResult;
        },
        diffPatch: async (args) => {
          calls.push(["diffPatch", args]);
          return patchResult;
        },
        markPullRequestReady: async (args) => {
          calls.push(["ready", args]);
          return { message: "Marked ready." };
        },
        markPullRequestDraft: async (args) => {
          calls.push(["draft", args]);
          return { message: "Marked draft." };
        },
        mergePullRequest: async (args) => {
          calls.push(["merge", args]);
          return { message: "Merged." };
        },
      },
      terminals: {
        list: async (args) => {
          calls.push(["list", args]);
          return { sessions: terminalSessions };
        },
        create: async (args) => {
          calls.push(["create", args]);
          return { id: `terminal-${++id}` };
        },
        get: async (args) => {
          calls.push(["get", args]);
          return { status: "running" };
        },
        input: async (args) => calls.push(["input", args]),
        output: async (args) => {
          calls.push(["output", args]);
          return {
            chunks: [{
              dataBase64: Buffer.from(terminalOutput).toString("base64"),
            }],
          };
        },
        close: async (args) => calls.push(["close", args]),
      },
    },
  };
  const card = { id: CARD_ID, status: "completed", workspace_kind: "project", workspace_host_id: null };
  const factory = createArtifactsPublication({
    db,
    bb,
    now: () => 1_000,
    randomId: (prefix) => `${prefix}-${++id}`,
    cardNotFound: "Card not found.",
    cards: {
      get: (cardId) => cardId === CARD_ID ? card : undefined,
      checkout: async () => ({
        path: "/workspace",
        hostId: "host-1",
        environmentId: ENVIRONMENT_ID,
        environment: { id: ENVIRONMENT_ID, isWorktree: true },
        source: "Worker worktree",
      }),
    },
    normalizeStatus: (value) => value,
  });
  return {
    db,
    calls,
    handlers: factory.handlers,
    events: () => db.prepare("SELECT * FROM publication_events ORDER BY created_at").all(),
    setStatus: (value) => { status = value; },
    setPullRequest: (value) => { pullRequestState = value; },
    setTerminalOutput: (value) => { terminalOutput = value; },
    setTerminalSessions: (value) => { terminalSessions = value; },
    setDiff: (value, patches = { outcome: "not_applicable", message: "No patch fixture." }) => {
      diffResult = value;
      patchResult = patches;
    },
  };
}

test("publication status projects the card environment and its latest event", async () => {
  const app = harness();
  app.db.prepare(`
    INSERT INTO publication_events
      (id, card_id, action, message, commit_sha, pull_request_url, created_at)
    VALUES ('owned', 'card-1', 'commit', 'Saved.', 'deadbee', NULL, 10)
  `).run();

  const result = await app.handlers.publicationStatus({ cardId: CARD_ID });

  assert.equal(result.available, true);
  assert.equal(result.source, "Worker worktree");
  assert.equal(result.environmentId, ENVIRONMENT_ID);
  assert.equal(result.branch.current, "feature/publication");
  assert.equal(result.workingTree.files, 1);
  assert.equal(result.capabilities.commit.available, true);
  assert.deepEqual(result.events.map((event) => event.id), ["owned"]);
  app.db.close();
});

test("push runs in the card environment and records the submitted command", async () => {
  const app = harness();

  const result = await app.handlers.publicationPushTerminal({ cardId: CARD_ID });

  assert.equal(result.ok, true);
  const create = app.calls.find(([name]) => name === "create");
  assert.deepEqual(create[1].scope, {
    kind: "environment",
    environmentId: ENVIRONMENT_ID,
  });
  const input = app.calls.find(([name]) => name === "input");
  const command = Buffer.from(input[1].dataBase64, "base64").toString("utf8");
  assert.match(command, /^git push; echo "STELOW_PUSH_EXIT:\$\?"\r$/);
  assert.equal(app.events().length, 1);
  assert.match(app.events()[0].message, /Ran git push in shell terminal-1/);
  app.db.close();
});

test("PR actions preflight capability and record the verified transition", async () => {
  const app = harness();

  const result = await app.handlers.publicationPullRequestAction({
    cardId: CARD_ID,
    operation: "draft",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(app.calls.map(([name]) => name), [
    "status",
    "pullRequest",
    "draft",
  ]);
  assert.equal(app.events().length, 1);
  assert.equal(app.events()[0].action, "pull_request_draft");
  assert.equal(
    app.events()[0].pull_request_url,
    "https://github.com/acme/project/pull/42",
  );
  app.db.close();
});

test("publication migration is repeatable and preserves durable history", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE cards (id TEXT PRIMARY KEY)");
  runPublicationMigrations(db);
  db.exec(`
    INSERT INTO cards VALUES ('card-1');
    INSERT INTO publication_events
      (id, card_id, action, message, commit_sha, pull_request_url, created_at)
    VALUES
      ('event-1', 'card-1', 'commit', 'Saved.', 'abc1234', NULL, 100)
  `);
  runPublicationMigrations(db);
  runPublicationMigrations(db);

  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM publication_events").get().count,
    1,
  );
  assert.deepEqual(
    db.prepare("SELECT * FROM publication_events").get(),
    {
      id: "event-1",
      card_id: "card-1",
      action: "commit",
      message: "Saved.",
      commit_sha: "abc1234",
      pull_request_url: null,
      created_at: 100,
    },
  );
  db.close();
});

test("commit diff is card-scoped and refuses before any BB environment read", async () => {
  const app = harness();
  app.db.prepare(`
    INSERT INTO publication_events
      (id, card_id, action, message, commit_sha, pull_request_url, created_at)
    VALUES ('other', 'card-2', 'commit', 'Other card.', 'deadbee', NULL, 10)
  `).run();

  const result = await app.handlers.publicationCommitDiff({
    cardId: CARD_ID,
    commitSha: "deadbee",
  });

  assert.equal(result.found, false);
  assert.match(result.error, /not recorded in this card's publication history/);
  assert.deepEqual(app.calls, []);
  app.db.close();
});

test("a recorded commit fetches only missing text-file patches", async () => {
  const app = harness();
  app.db.prepare(`
    INSERT INTO publication_events
      (id, card_id, action, message, commit_sha, pull_request_url, created_at)
    VALUES ('owned', 'card-1', 'commit', 'Saved.', 'deadbee', NULL, 10)
  `).run();
  app.setDiff({
    outcome: "available",
    shortstat: "2 files changed",
    truncated: false,
    initialPatches: [],
    files: [
      {
        path: "server.ts",
        binary: false,
        loadMode: "auto",
        changeKind: "modified",
        additions: 2,
        deletions: 1,
      },
      {
        path: "logo.png",
        binary: true,
        loadMode: "auto",
        changeKind: "modified",
        additions: 0,
        deletions: 0,
      },
    ],
  }, {
    outcome: "available",
    patches: [{ path: "server.ts", patch: "+ two lines", truncated: false }],
  });

  const result = await app.handlers.publicationCommitDiff({
    cardId: CARD_ID,
    commitSha: "deadbee",
  });

  assert.equal(result.found, true);
  assert.equal(result.files.find((file) => file.path === "server.ts").patch, "+ two lines");
  const patchCall = app.calls.find(([name]) => name === "diffPatch");
  assert.deepEqual(patchCall[1].paths, ["server.ts"], "binary files never need patch fetches");
  app.db.close();
});

test("commit runs a fresh capability preflight and records only BB's verified SHA", async () => {
  const app = harness();
  await app.handlers.publicationStatus({ cardId: CARD_ID });
  app.calls.length = 0;

  const result = await app.handlers.publicationCommit({ cardId: CARD_ID });

  assert.deepEqual(app.calls.slice(0, 3).map(([name]) => name), [
    "status",
    "pullRequest",
    "commit",
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.commitSha, "abcdef1234567890");
  assert.equal(app.events().length, 1);
  assert.equal(app.events()[0].action, "commit");
  assert.equal(app.events()[0].commit_sha, "abcdef1234567890");
  app.db.close();
});

test("a clean tree refuses commit without calling the BB writer", async () => {
  const app = harness();
  app.setStatus(availableStatus({ workingTree: { hasUncommittedChanges: false, files: [] } }));

  const result = await app.handlers.publicationCommit({ cardId: CARD_ID });

  assert.equal(result.ok, false);
  assert.match(result.message, /nothing to commit/);
  assert.equal(app.calls.some(([name]) => name === "commit"), false);
  assert.equal(app.events().length, 0);
  app.db.close();
});

test("duplicate push refusal creates no shell and records no event", async () => {
  const app = harness();
  app.setTerminalSessions([{
    id: "push-live",
    title: "Stelow push — feature/publication",
    status: "running",
    exitCode: null,
    createdAt: 20,
  }]);

  const result = await app.handlers.publicationPushTerminal({ cardId: CARD_ID });

  assert.equal(result.ok, false);
  assert.match(result.message, /push-live/);
  assert.equal(app.calls.some(([name]) => name === "create"), false);
  assert.equal(app.calls.some(([name]) => name === "input"), false);
  assert.equal(app.events().length, 0);
  app.db.close();
});

test("squash records a SHA only after a successful parsed verdict", async () => {
  const app = harness();
  app.setStatus(availableStatus({ workingTree: { hasUncommittedChanges: false, files: [] } }));
  app.setTerminalOutput([
    "STELOW_SQUASH_EXIT:0",
    "STELOW_SQUASH_SHA:1234567890abcdef",
    "STELOW_SQUASH_DONE:1",
  ].join("\n"));

  const result = await app.handlers.publicationSquashMerge({ cardId: CARD_ID });

  assert.equal(result.ok, true);
  assert.equal(result.commitSha, "1234567890abcdef");
  assert.equal(app.events().length, 1);
  assert.equal(app.events()[0].action, "squash_merge");
  assert.equal(app.events()[0].commit_sha, "1234567890abcdef");
  app.db.close();
});

test("a failed squash with a present SHA still records nothing", async () => {
  const app = harness();
  app.setStatus(availableStatus({ workingTree: { hasUncommittedChanges: false, files: [] } }));
  app.setTerminalOutput([
    "STELOW_SQUASH_EXIT:1",
    "STELOW_SQUASH_SHA:1234567890abcdef",
    "STELOW_SQUASH_DONE:1",
  ].join("\n"));

  const result = await app.handlers.publicationSquashMerge({ cardId: CARD_ID });

  assert.equal(result.ok, false);
  assert.equal(result.commitSha, null);
  assert.equal(app.events().length, 0);
  app.db.close();
});
