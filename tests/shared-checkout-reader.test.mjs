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

// The precedence, and the defect it fixes. A card that has claimed nothing yet
// is exactly the default state — card_claims is empty at rest, every claim is
// released when its card finishes — so a report that short-circuited on an empty
// claim set answered `no-overlap` with zero threads: a measurement nobody made,
// rendered as a clean one, and the "who else is in here" half suppressed by the
// "nothing of mine is at risk" half.
{
  const noClaims = reader({ deps: { db: fakeDb([]) } });
  const report = await noClaims.api.reportFor("card_1");
  assert.equal(report.reason, "unknown-footprint", "no claim set means the overlap was never measured");
  assert.equal(report.threads, 1, "and how many others are here is still a fact about the host");
  assert.deepEqual(report.lines, [], "with no measured overlap there is nothing to say about files");
  assert.equal(
    noClaims.calls.git,
    0,
    "and no subprocess is spent on an overlap there is no claim set to compare against",
  );
}

// The other half of the order: an empty checkout is answerable whatever the card
// holds, so it never reaches the ledger or git. Checking the population first is
// not only more honest, it is cheaper on the common path.
{
  const elsewhere = reader({
    threads: [
      { id: "thr_me", environmentPath: CHECKOUT, status: "active", originPluginId: "stelow" },
      { id: "thr_x", environmentPath: "/other/repo", status: "active" },
    ],
  });
  const report = await elsewhere.api.reportFor("card_1");
  assert.equal(report.reason, "no-threads", "nobody else in this checkout, whatever this card holds");
  assert.equal(report.threads, 0);
  assert.equal(elsewhere.calls.git, 0, "a file question about a tree nobody is in is not worth a subprocess");
}

// Two different answers from the same reader, not one default reached twice. A
// refactor that funnelled both through a single fallback would satisfy either
// test alone.
{
  const noClaims = reader({ deps: { db: fakeDb([]) } });
  const unmeasured = await noClaims.api.reportFor("card_1");
  const emptyCheckout = reader({
    threads: [{ id: "thr_x", environmentPath: "/other/repo", status: "active" }],
  });
  const empty = await emptyCheckout.api.reportFor("card_1");
  assert.notEqual(unmeasured.reason, empty.reason, "an unmeasured overlap and an empty checkout are different answers");
  assert.ok(unmeasured.threads > 0, "the first still carries the host's thread count");
  assert.equal(empty.threads, 0);
}

// The `shared` answer carries both halves from the same fixture: who is here and
// which of my files are involved. Two computations of "who is in this checkout"
// run (here and inside the lib), and this is what catches them disagreeing.
{
  const { api } = reader();
  const report = await api.reportFor("card_1");
  assert.equal(report.reason, "shared");
  assert.equal(report.threads, 1);
  assert.deepEqual(report.files, ["src/a.ts"]);
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

  // A ledger that cannot be read is the same shape of gap: this card's claim set
  // is unknown, so its overlap is unmeasured. Reporting `no-overlap` here would
  // be inventing a measurement out of a failed read.
  const noDb = reader({ deps: { db: { prepare: () => ({ all: () => { throw new Error("no table"); } }) } } });
  const ledgerFail = await noDb.api.reportFor("card_1");
  assert.equal(ledgerFail.reason, "unknown-footprint", "an unreadable claim ledger measures nothing");
  assert.equal(ledgerFail.threads, 1, "and the host's thread count survives the ledger failure");
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
  assert.equal(report.reason, "unknown-footprint", "holding nothing is not the same as overlapping nothing");
  assert.equal(empty.calls.list, 1, "the list is cached, so a second such card is free");

  const gone = reader();
  const missing = await gone.api.reportFor("nope");
  assert.equal(missing.reason, "no-checkout", "an unknown card is not a scan failure");
  assert.equal(gone.calls.list, 0, "and it never reaches the host");
}

// A host that answers with nothing at all is a different answer from a checkout
// with nobody in it: the first is the host failing, the second is measured.
{
  const emptyList = reader({ threads: [] });
  const unknown = await emptyList.api.reportFor("card_1");
  assert.equal(unknown.reason, "unavailable", "an empty host answer is not the same as an empty checkout");
}

console.log("shared checkout reader test ok: short-circuits isolation, caches the host list, fails soft");
