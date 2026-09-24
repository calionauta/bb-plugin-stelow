import Database from "better-sqlite3";
import {
  createArtifactsPublication,
  runPublicationMigrations,
} from "../../server/artifacts-publication.ts";

export const CARD_ID = "card-1";
export const ENVIRONMENT_ID = "env-1";

export function availableStatus(overrides = {}) {
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

function harnessState() {
  const state = {
    status: availableStatus(),
    pullRequest: pullRequest(),
    terminalOutput: "working",
    terminalSessions: [],
    terminalInputError: null,
    diff: { outcome: "not_applicable", message: "No diff fixture." },
    patches: { outcome: "not_applicable", message: "No patch fixture." },
    patchError: null,
  };
  return {
    state,
    setStatus: (value) => { state.status = value; },
    setPullRequest: (value) => { state.pullRequest = value; },
    setTerminalOutput: (value) => { state.terminalOutput = value; },
    setTerminalSessions: (value) => { state.terminalSessions = value; },
    setTerminalInputError: (value) => { state.terminalInputError = value; },
    setDiff: (value, patches) => {
      state.diff = value;
      state.patches = patches ?? state.patches;
    },
    setPatchError: (value) => { state.patchError = value; },
  };
}

function environmentSdk(state, calls) {
  return {
    status: async (args) => {
      calls.push(["status", args]);
      return state.status;
    },
    pullRequest: async (args) => {
      calls.push(["pullRequest", args]);
      return state.pullRequest;
    },
    commit: async (args) => {
      calls.push(["commit", args]);
      return { message: "Commit saved.", commitSha: "abcdef1234567890" };
    },
    diffFiles: async (args) => {
      calls.push(["diffFiles", args]);
      return state.diff;
    },
    diffPatch: async (args) => {
      calls.push(["diffPatch", args]);
      if (state.patchError) throw state.patchError;
      return state.patches;
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
  };
}

function terminalSdk(state, calls, nextId) {
  return {
    list: async (args) => {
      calls.push(["list", args]);
      return { sessions: state.terminalSessions };
    },
    create: async (args) => {
      calls.push(["create", args]);
      return { id: `terminal-${nextId()}` };
    },
    get: async (args) => {
      calls.push(["get", args]);
      return { status: "running" };
    },
    input: async (args) => {
      calls.push(["input", args]);
      if (state.terminalInputError) throw state.terminalInputError;
    },
    output: async (args) => {
      calls.push(["output", args]);
      return {
        chunks: [{
          dataBase64: Buffer.from(state.terminalOutput).toString("base64"),
        }],
      };
    },
    close: async (args) => calls.push(["close", args]),
  };
}

function publicationCard() {
  return {
    id: CARD_ID,
    status: "completed",
    workspace_kind: "project",
    workspace_host_id: null,
  };
}

function publicationCheckout() {
  return {
    path: "/workspace",
    hostId: "host-1",
    environmentId: ENVIRONMENT_ID,
    environment: { id: ENVIRONMENT_ID, isWorktree: true },
    source: "Worker worktree",
  };
}

function publicationDatabase() {
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
  return db;
}

export function harness() {
  const db = publicationDatabase();
  const calls = [];
  const controls = harnessState();
  const state = controls.state;
  let id = 0;
  const nextId = () => ++id;
  const bb = {
    log: { warn: (message) => calls.push(["warn", message]) },
    sdk: {
      environments: environmentSdk(state, calls),
      terminals: terminalSdk(state, calls, nextId),
    },
  };
  const card = publicationCard();
  const factory = createArtifactsPublication({
    db,
    bb,
    now: () => 1_000,
    randomId: (prefix) => `${prefix}-${nextId()}`,
    cardNotFound: "Card not found.",
    cards: {
      get: (cardId) => cardId === CARD_ID ? card : undefined,
      checkout: async () => publicationCheckout(),
    },
    normalizeStatus: (value) => value,
  });
  return {
    db,
    calls,
    handlers: factory.handlers,
    events: () => db.prepare(`
      SELECT * FROM publication_events ORDER BY created_at
    `).all(),
    setStatus: controls.setStatus,
    setPullRequest: controls.setPullRequest,
    setTerminalOutput: controls.setTerminalOutput,
    setTerminalSessions: controls.setTerminalSessions,
    setTerminalInputError: controls.setTerminalInputError,
    setDiff: controls.setDiff,
    setPatchError: controls.setPatchError,
  };
}
