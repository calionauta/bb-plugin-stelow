import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import Database from "better-sqlite3";
import { runScopeHistorySync } from "../server/runtime/scope-history-sync.ts";
import { createAdvancePreflight } from "../server/execution-advance-preflight.ts";

const HELPER = fileURLToPath(new URL("../data/stelow", import.meta.url));
const OWNED_TMP = mkdtempSync(join(tmpdir(), "scope-history-sync-tests-"));
const PRIOR_TMPDIR = process.env.TMPDIR;
process.env.TMPDIR = OWNED_TMP;
after(() => {
  if (PRIOR_TMPDIR === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = PRIOR_TMPDIR;
  rmSync(OWNED_TMP, { recursive: true, force: true });
});
const sha = (value) => createHash("sha256").update(value).digest("hex");
const PRESERVE = ["sync-scopes", "--preserve-history", "--move-task", "scope-3:3.4:scope-1", "--json"];
const IDS = ["scope-1", "scope-6", "scope-7", "scope-8", "scope-9"];
const TYPES = { 6: "test-unit", 7: "test-integration", 8: "test-security", 9: "test-behavior" };
const OLD_SPEC = "# Historical technical plan\n";
const TASKS = [["1.1", "Establish diagnostic context"], ["1.2", "Preserve source identities"], ["1.3", "Publish immutable originals"]];

function specBlock(number) {
  const rows = number === 1 ? [...TASKS, ["2.1", "Provision local backend"], ["4.1", "Verify coherent recovery"]]
    : [[`${number}.1`, `Verify track ${number}`]];
  return [
    `[SCOPE-${number}] ${number === 1 ? "Integrated foundations" : `Scope ${number}`}`,
    `[TYPE] ${TYPES[number] ?? "feature"}`, `[MAX_ITERATIONS] ${number === 1 ? 5 : 3}`,
    "[TARGET_FILES]", `- src/scope-${number}.ts`, "", "Dependencies: none", "",
    "| # | Task | Done Criterion |", "| --- | --- | --- |",
    ...rows.map(([id, name]) => `| ${id} | ${name} | |`), "",
  ].join("\n");
}
const NEW_SPEC = [1, 6, 7, 8, 9].map(specBlock).join("\n");

function oldWorkflow() {
  const scopes = Array.from({ length: 9 }, (_, index) => ({
    id: `scope-${index + 1}`, name: `Scope ${index + 1}`, type: TYPES[index + 1] ?? "feature",
    blockedBy: [], targetFiles: [`src/scope-${index + 1}.ts`], maxIterations: 3, status: "pending", tasks: [],
  }));
  Object.assign(scopes[0], {
    status: "in-progress", started_at: "2026-11-05T06:24:00.310634+00:00", start_sha: "a".repeat(40), iteration_count: 3,
    record: { verified: true, meaning: "Historical diagnostic subset", rounds: [1, 2, 3], freeze_sha: "c".repeat(64) },
    tasks: [...TASKS.map(([id, name]) => ({ id, name, status: "done", source: "planned", note: "Original proof" })),
      { id: "1.4", name: "Review core findings", status: "skipped", source: "discovered", note: "Deferred to3.4" }],
  });
  scopes[2].tasks = [{ id: "3.4", name: "Mandatory release hardening", status: "pending", source: "discovered", note: "Keep N1-N9 open" }];
  return {
    name: "memory-hub-fixture", workflowId: "card_sync", dirHash: "sync-fixture", created: "2026-11-05T06:00:00.000Z",
    status: "in-progress", specTechFile: "spec-tech_v2.md", specTechSha256: sha(OLD_SPEC), scopes,
    originalReceipt: { id: "receipt_original" },
  };
}

function tree(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? tree(path).map(([child, bytes]) => [join(entry.name, child), bytes])
      : [[entry.name, readFileSync(path).toString("base64")]];
  });
}
const lockTree = (f) => tree(join(f.root, ".stelow", "locks"));

async function canonical(args, cwd, stateDir) {
  const env = { ...process.env, STELOW_STATEDIR: stateDir, STELOW_STATE: join(stateDir, "state.md") };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  let child;
  let result;
  const errors = [];
  try {
    result = await new Promise((resolve) => {
      child = execFile("bash", [HELPER, ...args], { cwd, env, detached: true, timeout: 15_000, maxBuffer: 1_048_576 },
        (error, stdout, stderr) => resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout, stderr: stderr || error?.message || "" }));
    });
  } catch (error) {
    errors.push(error);
  } finally {
    if (child?.pid) {
      try { process.kill(-child.pid, "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") errors.push(error); }
    }
  }
  if (errors.length) throw new AggregateError(errors, "Canonical helper or owned process cleanup failed");
  return result;
}

function writer(f) {
  return { write: async (request) => {
    assert.ok(relative(f.root, request.path) && !relative(f.root, request.path).startsWith(".."));
    f.writes.push(request);
    if (f.fail === "backup-writer" && request.path !== f.tracker) throw new Error("Injected backup writer failure");
    if (f.fail === "tracker-writer" && request.path === f.tracker) throw new Error("Injected tracker writer failure");
    f.beforeWrite?.(request);
    const exists = existsSync(request.path);
    const current = exists ? sha(readFileSync(request.path)) : null;
    const expected = request.expectedSha256;
    if (expected !== undefined && (expected === null ? exists : expected !== current)) return { outcome: "conflict" };
    if (request.createParents) mkdirSync(dirname(request.path), { recursive: true });
    const bytes = Buffer.from(request.content, request.contentEncoding === "base64" ? "base64" : "utf8");
    writeFileSync(request.path, bytes, { mode: request.mode });
    f.afterWrite?.(request);
    return { outcome: "written", sha256: sha(bytes) };
  } };
}

function fixture(t) {
  const root = mkdtempSync(join(OWNED_TMP, "case-"));
  const stateDir = join(root, ".stelow", "2026-11-05", "sync-fixture");
  const f = { root, stateDir, tracker: join(root, "stelow.json"), spec: join(stateDir, "plans", "spec-tech_v3.md"),
    calls: [], writes: [], scratch: [], parsed: [], allowedLocks: [] };
  mkdirSync(dirname(f.spec), { recursive: true });
  writeFileSync(f.spec, NEW_SPEC);
  writeFileSync(join(dirname(f.spec), "spec-tech_v2.md"), OLD_SPEC);
  writeFileSync(join(stateDir, "state.md"), "---\nworkflow_id: card_sync\ncurrent_stage: execution\n---\nOriginal clock and receipt.\n");
  f.before = { format: "keep", workflows: [oldWorkflow(), { name: "other", workflowId: "card_other", status: "done", note: "Untouched" }] };
  f.original = `${JSON.stringify(f.before, null, "\t")}\n`;
  writeFileSync(f.tracker, f.original);
  f.files = writer(f);
  f.invoke = async (args, cwd, state) => {
    f.calls.push({ args, cwd, state });
    if (args[0] === "sync-scopes") {
      if (cwd !== root) f.scratch.push(cwd);
      if (f.fail === "parser" || f.fail === "raw-call") return { code: 1, stdout: "", stderr: "Injected canonical parser refusal" };
      if (f.fail === "parser-noop") return { code: 0, stdout: "{}", stderr: "" };
    }
    if (args[0] === "lock" && args[1] === "release" && f.throwReleaseOnce) {
      f.throwReleaseOnce = false;
      f.releaseThrows = (f.releaseThrows ?? 0) + 1;
      throw new Error("Injected release transport exception");
    }
    const result = await canonical(args, cwd, state);
    if (args[0] === "sync-scopes" && result.code === 0) {
      f.parsed.push(JSON.parse(readFileSync(join(cwd, "stelow.json"), "utf8")).workflows[0]);
    }
    return result;
  };
  f.run = (args = PRESERVE) => runScopeHistorySync(args, root, stateDir, f.invoke, f.files);
  t.after(() => {
    try {
      for (const path of f.scratch) assert.equal(existsSync(path), false, "temporary canonical-parser workspace is removed");
      assert.deepEqual(lockTree(f), f.allowedLocks, "no owned reservation remains or foreign reservation changes");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  return f;
}

async function apply(f) {
  const result = await f.run();
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

for (const dry of [false, true]) {
  test(`new-plan sync refuses implicit history replacement, dry-run=${dry}`, async (t) => {
    const f = fixture(t);
    const before = tree(f.root);
    const result = await f.run(["sync-scopes", ...(dry ? ["--dry-run"] : []), "--json"]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /preserve-history/);
    assert.deepEqual(tree(f.root), before);
    assert.deepEqual(f.writes, []);
  });
}

test("explicit preview parses exactly five scopes without live writes or backups", async (t) => {
  const f = fixture(t);
  const before = tree(f.root);
  const result = await f.run([...PRESERVE, "--dry-run"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).wouldSync, 5);
  assert.deepEqual(f.parsed[0].scopes.map((scope) => scope.id), IDS);
  assert.deepEqual(tree(f.root), before);
  assert.deepEqual(f.writes, []);
});

test("apply preserves execution facts and archives the exact prior tracker outside scanned artifacts", async (t) => {
  const f = fixture(t);
  const state = readFileSync(join(f.stateDir, "state.md"), "utf8");
  const result = await apply(f);
  const current = JSON.parse(readFileSync(f.tracker, "utf8"));
  const workflow = current.workflows[0];
  assert.deepEqual(workflow.scopes.map((scope) => scope.id), IDS);
  for (const key of ["status", "started_at", "start_sha", "iteration_count", "record"]) {
    assert.deepEqual(workflow.scopes[0][key], f.before.workflows[0].scopes[0][key]);
  }
  for (const task of f.before.workflows[0].scopes[0].tasks) {
    assert.deepEqual(workflow.scopes[0].tasks.find((entry) => entry.id === task.id), task);
  }
  assert.deepEqual(workflow.scopes[0].tasks.find((task) => task.id === "3.4"), f.before.workflows[0].scopes[2].tasks[0]);
  assert.deepEqual(workflow.scopeHistory.at(-1).scopes, f.before.workflows[0].scopes);
  assert.equal(workflow.specTechFile, "spec-tech_v3.md");
  assert.equal(workflow.specTechSha256, sha(NEW_SPEC));
  assert.deepEqual(current.workflows[1], f.before.workflows[1]);
  assert.equal(current.format, "keep");
  assert.equal(readFileSync(join(f.stateDir, "state.md"), "utf8"), state);
  assert.ok(relative(f.root, result.backup) && !relative(f.root, result.backup).startsWith(".."));
  assert.notEqual(relative(f.root, result.backup).split(sep)[0], ".stelow");
  assert.equal(readFileSync(result.backup, "utf8"), f.original);
  assert.equal(f.writes.find((write) => write.path === f.tracker).expectedSha256, sha(f.original));
});

test("same identity/hash is idempotent without falling back to a raw mutating sync", async (t) => {
  const f = fixture(t);
  await apply(f);
  const before = tree(f.root);
  f.fail = "raw-call";
  const result = await f.run(["sync-scopes", "--json"]);
  assert.equal(result.code, 0, "an already pinned plan needs no raw helper execution");
  assert.deepEqual(tree(f.root), before);
});

test("a concurrent tracker edit wins its CAS and is never dropped", async (t) => {
  const f = fixture(t);
  const changed = `${JSON.stringify({ ...f.before, concurrentMarker: "keep-this-change" })}\n`;
  f.beforeWrite = (request) => { if (request.path === f.tracker) writeFileSync(f.tracker, changed); };
  const result = await f.run();
  assert.notEqual(result.code, 0);
  assert.equal(readFileSync(f.tracker, "utf8"), changed);
});

for (const boundary of ["backup", "tracker-CAS"]) {
  test(`a target spec edit at the ${boundary} commit boundary cannot report success`, async (t) => {
    const f = fixture(t);
    const edited = `${NEW_SPEC}\nThe target changed during commit.\n`;
    if (boundary === "backup") f.afterWrite = (request) => {
      if (request.path !== f.tracker) writeFileSync(f.spec, edited);
    };
    else f.beforeWrite = (request) => { if (request.path === f.tracker) writeFileSync(f.spec, edited); };
    const result = await f.run();
    assert.notEqual(result.code, 0);
    assert.equal(readFileSync(f.spec, "utf8"), edited);
    if (boundary === "backup") assert.equal(readFileSync(f.tracker, "utf8"), f.original);
  });
}

test("a held foreign reservation is never stolen and failed acquisition leaves no partial owned locks", async (t) => {
  const f = fixture(t);
  const held = await f.invoke(["lock", "acquire", "--scope", "foreign-owner", "--ttl", "3600", "--file", f.tracker, "--json"],
    f.root, join(f.root, ".stelow"));
  assert.equal(held.code, 0, held.stderr);
  f.allowedLocks = lockTree(f);
  const result = await f.run();
  assert.notEqual(result.code, 0);
  assert.equal(readFileSync(f.tracker, "utf8"), f.original);
  assert.deepEqual(lockTree(f), f.allowedLocks);
});

for (const fault of ["parser", "parser-noop", "backup-writer", "tracker-writer"]) {
  test(`${fault} cannot report a successful migration`, async (t) => {
    const f = fixture(t);
    f.fail = fault;
    const result = await f.run();
    assert.notEqual(result.code, 0);
    assert.equal(readFileSync(f.tracker, "utf8"), f.original);
  });
}

test("a release exception is surfaced or recovered without stranding an owned lease", async (t) => {
  const f = fixture(t);
  f.throwReleaseOnce = true;
  const result = await f.run();
  assert.equal(f.releaseThrows, 1);
  assert.deepEqual(lockTree(f), []);
  if (result.code !== 0) assert.match(result.stderr, /release|lock/i);
});

test("editing the active spec in place refuses even when its scope count still matches", async (t) => {
  const f = fixture(t);
  await apply(f);
  writeFileSync(f.spec, `${NEW_SPEC}\nChanged in place.\n`);
  const before = tree(f.root);
  const result = await f.run();
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /in place|version/i);
  assert.deepEqual(tree(f.root), before);
});

for (const [dryRun, throws] of [[true, false], [false, false], [false, true]]) {
  test(`advance stops before routing on refused sync: dry=${dryRun}, throws=${throws}`, async (t) => {
    const f = fixture(t);
    const before = tree(f.root);
    const db = new Database(":memory:");
    db.exec("CREATE TABLE execution_runs (id TEXT, card_id TEXT, stage TEXT, created_at INTEGER, "
      + "recipe_id TEXT, error_code TEXT, normalized_status TEXT)");
    let routes = 0;
    const preflight = createAdvancePreflight({
      db, runHelper: throws ? async () => { throw new Error("Injected sync transport exception"); } :
        (args, cwd, state) => runScopeHistorySync(args, cwd, state, f.invoke, f.files),
      native: { resolveStageExecutionRoute: async () => { routes++; return null; } },
      reworkNote: async () => "", recordExecutionEntry: () => {}, scopeMapApproved: async () => true,
    });
    try {
      const outcome = await preflight.prepareAdvance({ card: { id: "card_sync", kind: "build", stage: "planning", intent: "feature" },
        stage: "execution", rootPath: f.root, stateDir: f.stateDir, dryRun, includeRework: false })
        .then((result) => result, (error) => ({ error: error.message }));
      assert.ok(outcome.error, "a dry run or real advance may not silently bypass a sync failure");
      assert.match(outcome.error, throws ? /Injected sync transport exception/ : /preserve-history/);
      assert.equal(routes, 0);
      assert.deepEqual(tree(f.root), before);
    } finally { db.close(); }
  });
}
