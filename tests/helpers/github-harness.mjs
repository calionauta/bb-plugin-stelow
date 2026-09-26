/**
 * Harness for the GitHub issue slices: a real sqlite database (cards +
 * the feature's own migrations) and a fake `github` plugin behind the real
 * RPC seam, so the tests exercise the shipped wiring, not a mock of it.
 *
 * Every control below moves a real behavior: the item list, the auth state,
 * the comment echo, the spawn environment. A test that cannot be made to fail
 * by flipping one of them does not belong here.
 */
import Database from "better-sqlite3";
import { createGithubAutomation } from "../../server/github-issues.ts";
import { runGithubMigrations } from "../../server/github-migrations.ts";

export const REPO = "acme/widgets";

export function issue(overrides = {}) {
  return {
    repo: REPO,
    number: 1,
    kind: "issue",
    title: "Login is broken",
    state: "open",
    author: "octocat",
    labels: ["bug"],
    assignees: [],
    url: `https://github.com/${REPO}/issues/1`,
    body: "It 500s on submit.",
    updatedAt: "2026-09-20T10:00:00Z",
    ...overrides,
  };
}

function issueDetail(entry) {
  return { issue: entry };
}

function database() {
  const db = new Database(":memory:");
  // Foreign keys stay OFF, as in the plugin host: the claim protocol's
  // liveness rules are written for a database where a deleted card leaves a
  // dangling card_id instead of nulling the link.
  db.exec(`
    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      intent TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      project_id TEXT
    );
  `);
  runGithubMigrations(db);
  db.pragma("foreign_keys = OFF");
  return db;
}

export function insertCardRow(db, row) {
  db.prepare("INSERT OR IGNORE INTO cards (id, display_name, name, prompt, intent, stage, status, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(row.id, row.display_name, row.name, row.prompt, row.intent, row.stage, row.status, row.project_id);
}

function cardRow(overrides = {}) {  return {
    id: "card-1",
    display_name: null,
    name: "Fix login",
    prompt: "It 500s on submit.",
    intent: "bugfix",
    stage: "Build",
    status: "active",
    project_id: "project-1",
    ...overrides,
  };
}

/**
 * @param options.items       open issues the fake plugin lists
 * @param options.ghOk        whether GitHub is connected
 * @param options.repos       repo -> project mapping the plugin reports
 * @param options.envKind     effective spawn environment for the spawn gate
 * @param options.failList    reject listItems (simulates the plugin being down)
 * @param options.failComment reject commentIssue
 * @param options.cards       the card rows the host knows about
 */
function fakePluginReplies(state) {
  return {
    status: async () => ({
      ghOk: state.ghOk,
      ghState: state.ghOk ? "ready" : "unauthenticated",
      repos: state.repos,
      lastSyncedAt: null,
    }),
    listItems: async () => {
      if (state.failList) throw new Error(state.failList);
      return { items: state.items };
    },
    getIssue: async ({ repo, number }) => {
      const found = state.items.find((entry) => entry.repo === repo && entry.number === number);
      if (!found) throw new Error(`no such issue ${repo}#${number}`);
      // GitHub echoes what you posted; a test that needs the opposite turns
      // echoPosts off to reproduce a lag the write-back must survive.
      const echoed = state.posted.map((body) => ({ author: "you", body, createdAt: "2026-09-21T12:00:00Z" }));
      return issueDetail({ ...found, comments: state.echoPosts ? [...state.comments, ...echoed] : state.comments });
    },
    setLabels: async (input) => {
      state.labeled.push(input);
      return { ok: true, labels: input.labels };
    },
    assignableUsers: async () => ({ users: ["octocat"] }),
    repositoryLabels: async () => ({ labels: ["bug", "chore"] }),
    commentIssue: async (input) => {
      if (state.failComment) throw new Error(state.failComment);
      state.posted.push(input.body);
      return { ok: true };
    },
    setIssueState: async (input) => {
      if (state.failClose) throw new Error(state.failClose);
      state.closed.push(input.state);
      return { ok: true };
    },
  };
}

function hostCardAccessors(state, db, options, nextId) {
  const created = [];
  const comments = [];
  return {
    created,
    comments,
    accessors: {
      get: (cardId) => state.cardRows.find((row) => row.id === cardId),
      create: async (args) => {
        created.push(args);
        const cardId = `card-${nextId()}`;
        state.cardRows.push(cardRow({ id: cardId, name: `Card ${cardId}`, project_id: args.projectId }));
        insertCardRow(db, {
          id: cardId,
          display_name: null,
          name: `Card ${cardId}`,
          prompt: args.prompt,
          intent: args.intent,
          stage: "Shape",
          status: "draft",
          project_id: args.projectId,
        });
        return { cardId, threadId: null };
      },
      comment: (cardId, target, targetId, author, body) => {
        comments.push({ cardId, target, targetId, author, body });
        return "comment-1";
      },
      workspace: async () => ({ path: "/workspace", hostId: null }),
      scopes: () => options.scopes ?? [],
      normalizeStatus: (value) => value,
      statusLabel: (status) => status,
    },
  };
}

/** The host API surface: a log, a realtime channel, and the github plugin. */
function hostApi(state) {
  const replies = fakePluginReplies(state);
  return {
    log: { warn: (message) => state.warned.push(String(message)) },
    realtime: { publish: (topic, payload) => state.events.push([topic, payload]) },
    sdk: {
      plugins: {
        callRpc: async ({ pluginId, method, input }) => {
          if (pluginId !== "github") throw new Error(`unexpected plugin ${pluginId}`);
          const reply = replies[method];
          if (!reply) throw new Error(`unexpected method ${method}`);
          return reply(input);
        },
      },
    },
  };
}

export function harness(options = {}) {
  const db = options.db ?? database();
  const state = {
    items: options.items ?? [issue()],
    ghOk: options.ghOk ?? true,
    repos: options.repos ?? [{ repo: REPO, projectId: "project-1" }],
    envKind: options.envKind ?? "new-worktree",
    worktreePresetId: options.worktreePresetId ?? "preset-1",
    pinSucceeds: options.pinSucceeds ?? true,
    failList: options.failList ?? null,
    failComment: options.failComment ?? null,
    failClose: options.failClose ?? null,
    posted: [],
    closed: [],
    labeled: [],
    warned: [],
    events: [],
    comments: options.comments ?? [],
    echoPosts: options.echoPosts ?? true,
    cardRows: options.cards ?? [cardRow()],
  };
  // The rows the host knows about exist in `cards` too, so a seeded link is
  // legal; a test that needs a link to a DEAD card points the link at a card
  // that was never created, which is what a released crash leaves behind.
  for (const row of state.cardRows) insertCardRow(db, row);
  let id = 0;
  const nextId = () => ++id;
  const host = hostCardAccessors(state, db, options, nextId);

  const bb = hostApi(state);
  const automation = createGithubAutomation({
    db,
    bb,
    now: () => 1_700_000_000_000,
    randomId: (prefix) => `${prefix}-${nextId()}`,
    presets: {
      getWorktreePresetId: () => state.worktreePresetId,
      getEffectiveBuildEnvironmentKind: () => state.envKind,
      pinCardPreset: (cardId, presetId) => {
        state.pinned = { cardId, presetId };
        return state.pinSucceeds;
      },
    },
    cards: host.accessors,
  });

  return { db, bb, state, created: host.created, comments: host.comments, ...automation };
}

/** Link a card to an issue the way a previous import would have. */
export function seedImport(db, { key = `${REPO}#1`, cardId = "card-1", commentedAt = null } = {}) {
  db.prepare("INSERT INTO github_imports (issue_key, repo, number, label, card_id, imported_at, commented_at) VALUES (?, ?, ?, 'bug', ?, 1, ?)")
    .run(key, REPO, Number(key.split("#")[1]), cardId, commentedAt);
}
