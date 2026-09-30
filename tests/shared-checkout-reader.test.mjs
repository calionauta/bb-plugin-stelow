import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

// The reader is a server module, so it is loaded the way the server loads it.
// The behaviour under test is the wiring, not the prose: what it short-circuits,
// what it caches, and what it does when the host cannot answer.
register(pathToFileURL(new URL("../tests/register-ts-source.mjs", import.meta.url).pathname), import.meta.url);
const { createSharedCheckoutReader } = await import("../server/runtime/shared-checkout.ts");

const CHECKOUT = "/home/dev/repos/app";
const NOW = 1_000_000;

// `liveClaimsForWorkspace` is a real query against `card_claims`; the fake db
// answers it the way the schema does, so the reader's own filtering of rows to
// this card is genuinely exercised.
function fakeDb(rows) {
  return {
    prepare(sql) {
      assert.match(sql, /FROM card_claims/, "the claim ledger is the only source of held files");
      return { all: (...args) => rows.filter((r) => r.workspace_path === args[0] && r.expires_at > args[1]) };
    },
  };
}

const claim = (cardId, file) => ({
  workspace_path: CHECKOUT, file_path: file, card_id: cardId,
  scope: "S1", expires_at: NOW + 60_000, fencing: 1,
});

function reader(overrides = {}) {
  const calls = { list: 0, git: 0 };
  const deps = {
    db: fakeDb([claim("card_1", "src/a.ts")]),
    getCard: (id) => (id === "card_1" ? { id } : undefined),
    cardWorkspace: async () => ({ path: overrides.worktree ? "/w/sw-card_1" : CHECKOUT }),
    dirtyStatusIn: async () => {
      calls.git += 1;
      return overrides.dirty ?? " M src/a.ts\0";
    },
    listThreads: async () => {
      calls.list += 1;
      return overrides.threads ?? [{ id: "thr_other", environmentPath: CHECKOUT, status: "active" }];
    },
    now: () => NOW,
    ...overrides.deps,
  };
  return { api: createSharedCheckoutReader(deps), calls };
}

// The whole point of the short-circuit: a managed worktree is already
// unreachable, so the reader must answer without spending either subprocess.
{
  const { api, calls } = reader({ worktree: true });
  const report = await api.reportFor("card_1");
  assert.equal(report.reason, "isolated", "an isolated card says why it has nothing to report");
  assert.equal(report.isolated, true);
  assert.equal(calls.list, 0, "a card in a worktree never asks the host about threads");
  assert.equal(calls.git, 0, "and never reads a working tree — that is the cost this avoids");
}

// The default configuration: no New-worktree preset, so the card shares the
// project checkout, and another thread is editing a file the card holds.
{
  const { api, calls } = reader();
  const report = await api.reportFor("card_1");
  assert.equal(report.reason, "shared");
  assert.equal(report.threads, 1);
  assert.deepEqual(report.files, ["src/a.ts"], "the overlap is this card's held file, and only that one");
  assert.equal(calls.list, 1);
  assert.equal(calls.git, 1);
}

// The cache: two readers of the same host fact, one call. Without it, opening
// a card twice costs two `bb thread list` invocations for an answer that
// changes on a human timescale.
{
  let clock = NOW;
  let listCalls = 0;
  const { api } = reader({
    deps: {
      now: () => clock,
      listThreads: async () => {
        listCalls += 1;
        return [{ id: "thr_other", environmentPath: CHECKOUT, status: "active" }];
      },
    },
  });
  await api.reportFor("card_1");
  await api.reportFor("card_1");
  assert.equal(listCalls, 1, "a second read inside the TTL costs no subprocess");
  clock += 31_000;
  await api.reportFor("card_1");
  assert.equal(listCalls, 2, "past the TTL the host is asked again, so a new agent is seen");
  api.invalidate();
  await api.reportFor("card_1");
  assert.equal(listCalls, 3, "and invalidate drops it outright");
}

// Fail-soft is the contract of this surface: it is a report, and a report that
// errors is worse than one that says nothing, because the reader cannot tell
// which one they are looking at.
{
  const broken = reader({
    deps: { listThreads: async () => { throw new Error("bb not on PATH"); } },
  });
  const report = await broken.api.reportFor("card_1");
  assert.equal(report.reason, "unavailable", "a host that cannot answer says so, and does not throw");
  assert.deepEqual(report.lines, []);

  const noGit = reader({ deps: { dirtyStatusIn: async () => { throw new Error("not a repo"); } } });
  const gitFail = await noGit.api.reportFor("card_1");
  assert.equal(gitFail.reason, "no-overlap", "an unreadable working tree is not exposure");

  const noDb = reader({ deps: { db: { prepare: () => ({ all: () => { throw new Error("no table"); } }) } } });
  const ledgerFail = await noDb.api.reportFor("card_1");
  assert.equal(ledgerFail.reason, "no-overlap", "a ledger mid-migration is not an error either");
}

// Another card's claim in the same workspace is not this card's exposure. The
// claim ledger is keyed by workspace, so without the card filter every dirty
// file anyone holds in the checkout would be reported to every card in it —
// which is exactly the noise the card-occupancy section does not produce.
{
  const neighbour = reader({
    deps: {
      db: fakeDb([
        claim("card_1", "src/a.ts"),
        claim("card_2", "src/theirs.ts"),
      ]),
    },
    dirty: " M src/a.ts\0 M src/theirs.ts\0",
  });
  const report = await neighbour.api.reportFor("card_1");
  assert.deepEqual(report.files, ["src/a.ts"], "only the files THIS card holds are its exposure");
}

// A card that holds nothing, and a card that does not exist, both answer
// without touching the host.
{
  const empty = reader({ deps: { db: fakeDb([]) } });
  const report = await empty.api.reportFor("card_1");
  assert.equal(report.reason, "no-overlap");
  assert.equal(empty.calls.list, 1, "the list is cached, so a second such card is free");

  const gone = reader();
  const missing = await gone.api.reportFor("nope");
  assert.equal(missing.reason, "no-checkout", "an unknown card is not a scan failure");
  assert.equal(gone.calls.list, 0, "and it never reaches the host");
}

// Threads present but nobody in this checkout: a clean answer, distinct from a
// host that could not be read, because the reader must be able to tell the
// reader which one it is.
{
  const elsewhere = reader({
    threads: [{ id: "thr_x", environmentPath: "/other/repo", status: "active" }],
  });
  const report = await elsewhere.api.reportFor("card_1");
  assert.equal(report.reason, "no-threads");
  assert.equal(report.threads, 0);

  const emptyList = reader({ threads: [] });
  const unknown = await emptyList.api.reportFor("card_1");
  assert.equal(unknown.reason, "unavailable", "an empty host answer is not the same as an empty checkout");
}

console.log("shared checkout reader test ok: short-circuits isolation, caches the host list, fails soft");
