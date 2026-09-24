import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import {
  createWorkspacesRecovery,
  recoveredCheckoutIntegrity,
  runWorkspaceRecoveryMigrations,
} from "../server/workspaces-recovery.ts";

const CHECKOUT = "/registered/checkout";
const CLEAN_CHECKOUT = "/registered/clean";
const OTHER_HOST_CHECKOUT = "/registered/other-host";
const UNREGISTERED_CHECKOUT = "/private/unregistered";
const WORKSPACE = "/preserved/exploratory";

function card(overrides = {}) {
  return {
    id: "source-card",
    name: "source-card",
    display_name: "Original work",
    status: "completed",
    workspace_kind: "exploratory",
    workspace_path: WORKSPACE,
    workspace_host_id: "host-a",
    worker_thread_id: "thread-1",
    last_assistant_text: `Changes are uncommitted in \`${CHECKOUT}\`.`,
    ...overrides,
  };
}

function recoveryGitEvidence(path) {
  if (path === CHECKOUT) {
    return {
      isGit: true,
      gitRoot: "/git/root",
      branch: "feature/recovery",
      headSha: "1234567890abcdef",
      changedFiles: 3,
    };
  }
  if (path === UNREGISTERED_CHECKOUT) {
    return { isGit: true, gitRoot: "/other/root", branch: null, headSha: "abc", changedFiles: 1 };
  }
  return { isGit: false, gitRoot: null, branch: null, headSha: null, changedFiles: 0 };
}

function registeredSources() {
  return [
    { path: CHECKOUT, hostId: "host-a" },
    { path: CLEAN_CHECKOUT, hostId: "host-a" },
    { path: OTHER_HOST_CHECKOUT, hostId: "host-b" },
  ];
}

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      name TEXT NOT NULL
    );
  `);
  runWorkspaceRecoveryMigrations(db);
  db.prepare("INSERT INTO cards (id, display_name, name) VALUES (?, ?, ?)")
    .run("source-card", "Original work", "source-card");
  db.prepare("INSERT INTO cards (id, display_name, name) VALUES (?, ?, ?)")
    .run("audit-card", "Recovery audit", "audit-card");
  return db;
}

function harness({ sources = registeredSources(), threadOutput = "" } = {}) {
  const db = createDb();
  const cards = new Map([
    ["source-card", card()],
    ["audit-card", card({
      id: "audit-card",
      name: "audit-card",
      display_name: "Recovery audit",
      workspace_kind: "project",
      workspace_path: null,
    })],
  ]);
  const events = [];
  const comments = [];
  const created = [];
  const app = createWorkspacesRecovery({
    db,
    now: () => 1_234,
    publish: (event, payload) => events.push({ event, payload }),
    cardNotFound: "Card not found.",
    cardArchived: "This card is archived.",
    cards: {
      get: (cardId) => cards.get(cardId),
      create: async (input) => {
        created.push(input);
        return { cardId: "audit-card" };
      },
      comment: (cardId, target, targetId, author, body) => {
        comments.push({ cardId, target, targetId, author, body });
        return `comment-${comments.length}`;
      },
    },
    gitEvidence: (path) => recoveryGitEvidence(path),
    listProjects: async () => [{ id: "project-1", name: "Registered project", sources }],
    getProject: async () => ({
      sources: [
        { path: UNREGISTERED_CHECKOUT, hostId: "host-a", isDefault: true },
        { path: CHECKOUT, hostId: "host-a" },
      ],
    }),
    getThreadOutput: async () => threadOutput,
  });
  return { app, cards, comments, created, db, events };
}

test("workspace recovery admits only the reported registered checkout with changes", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "stelow-recovery-"));
  writeFileSync(join(workspace, "stelow.json"), "{}");
  const { app, comments, db, events } = harness();
  const reported = [CHECKOUT, CLEAN_CHECKOUT, OTHER_HOST_CHECKOUT, UNREGISTERED_CHECKOUT]
    .map((path) => `Changes are uncommitted in \`${path}\`.`)
    .join(" ");
  const source = card({ workspace_path: workspace, last_assistant_text: reported });
  const depsSnapshot = await app.snapshot(source);

  assert.equal(depsSnapshot.kind, "external-project");
  assert.equal(depsSnapshot.workspace.hasSource, false, "Stelow scaffolding is not source");
  assert.deepEqual(depsSnapshot.candidates.map((candidate) => candidate.path), [CHECKOUT]);
  assert.equal(depsSnapshot.candidates[0].changedFiles, 3);
  assert.deepEqual(
    (await app.handlers.workspaceRecovery({ cardId: "source-card" })).candidates.map((entry) => entry.path),
    [CHECKOUT],
    "the public recovery handler uses the same evidenced candidate policy",
  );

  const fallback = harness({
    threadOutput: `Changes are uncommitted in \`${CHECKOUT}\`.`,
  });
  const fromThread = await fallback.app.snapshot(card({ last_assistant_text: null }));
  assert.deepEqual(fromThread.candidates.map((entry) => entry.path), [CHECKOUT]);
  fallback.db.close();

  const attached = await app.handlers.attachRecoveryCheckout({
    cardId: "source-card",
    projectId: "project-1",
  });
  assert.deepEqual(attached, { ok: true, error: null });
  const row = db.prepare("SELECT * FROM workspace_recoveries WHERE card_id = 'source-card'").get();
  assert.equal(row.source_path, CHECKOUT);
  assert.equal(row.original_workspace_path, WORKSPACE);
  assert.equal(row.git_root, "/git/root");
  assert.equal(comments.length, 1, "attachment leaves an openable trail");
  assert.match(comments[0].body, /Original exploratory workspace remains preserved/);
  assert.deepEqual(events.map((event) => event.event), ["card-state", "board-changed"]);

  db.close();
  rmSync(workspace, { recursive: true, force: true });
});

test("audit creation fails closed when the attached project source changes", async () => {
  const { app, created, db } = harness();
  await app.handlers.attachRecoveryCheckout({ cardId: "source-card", projectId: "project-1" });
  db.prepare("UPDATE workspace_recoveries SET source_path = '/missing/checkout' WHERE card_id = 'source-card'").run();

  const result = await app.handlers.createRecoveryAudit({ cardId: "source-card" });

  assert.equal(result.ok, false);
  assert.match(result.error, /project source changed/);
  assert.equal(created.length, 0, "a changed project source cannot receive a recovery audit");
  db.close();
});

test("recovery audit is evidence-led, durable, and idempotent", async () => {
  const { app, cards, comments, created, db, events } = harness();
  const sourceBefore = structuredClone(cards.get("source-card"));
  await app.handlers.attachRecoveryCheckout({ cardId: "source-card", projectId: "project-1" });

  const createdResult = await app.handlers.createRecoveryAudit({ cardId: "source-card" });
  const repeated = await app.handlers.createRecoveryAudit({ cardId: "source-card" });

  assert.deepEqual(createdResult, {
    ok: true,
    auditCardId: "audit-card",
    auditCardName: "Recovery audit",
    error: null,
  });
  assert.deepEqual(repeated, createdResult);
  assert.deepEqual(cards.get("source-card"), sourceBefore, "the preserved source card is never rewritten");
  assert.equal(created.length, 1, "the recorded audit card is reused");
  assert.equal(created[0].projectId, "project-1");
  assert.equal(created[0].environment.workspace.path, CHECKOUT);
  assert.match(created[0].prompt, /Do not rewrite or complete the original exploratory card/);
  assert.deepEqual(comments.map(({ cardId }) => cardId), [
    "source-card",
    "source-card",
    "audit-card",
  ], "attachment and audit ownership leave card-specific trails");
  assert.deepEqual(events.map(({ event, payload }) => [event, payload.cardId]), [
    ["card-state", "source-card"],
    ["board-changed", "source-card"],
    ["card-state", "source-card"],
    ["card-state", "audit-card"],
    ["board-changed", "audit-card"],
  ]);
  db.close();
});

test("recovery migrations and checkout integrity preserve the reviewed Git root", () => {
  const { db } = harness();
  const source = card();
  db.prepare(`
    INSERT INTO workspace_recoveries
      (card_id, project_id, project_name, source_path, evidence, git_root, attached_at)
    VALUES ('source-card', 'project-1', 'Project', ?, 'reviewed', '/git/root', 1)
  `).run(CHECKOUT);
  db.prepare(`
    INSERT INTO recovery_audits (source_card_id, audit_card_id, created_at)
    VALUES ('source-card', 'audit-card', 2)
  `).run();
  runWorkspaceRecoveryMigrations(db);

  assert.deepEqual(
    db.prepare("SELECT source_path, attached_at FROM workspace_recoveries WHERE card_id = 'source-card'").get(),
    { source_path: CHECKOUT, attached_at: 1 },
    "repeat migration preserves the attachment ledger",
  );
  assert.deepEqual(
    db.prepare("SELECT source_card_id, audit_card_id, created_at FROM recovery_audits").get(),
    { source_card_id: "source-card", audit_card_id: "audit-card", created_at: 2 },
    "repeat migration preserves the durable audit relationship",
  );
  return Promise.all([
    recoveredCheckoutIntegrity({
      db,
      gitEvidence: async () => ({
        isGit: true,
        gitRoot: "/git/root",
      }),
    }, source, CHECKOUT).then((error) => {
      assert.equal(error, null, "the reviewed Git root remains usable");
    }),
    recoveredCheckoutIntegrity(
      { db, gitEvidence: async () => ({ isGit: true, gitRoot: "/other/root" }) },
      source,
      CHECKOUT,
    ).then((error) => {
      assert.match(error, /no longer resolves to the Git root you reviewed/);
    }),
  ]).finally(() => db.close());
});
