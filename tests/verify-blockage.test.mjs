import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyVerifyBlockage } from "../lib/verify-blockage.mjs";
import { createVerifyBlockageReader } from "../server/runtime/verify-blockage.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");

// The classifier: a failed run on a moved tree is stale evidence, the same
// failure on the same tree will repeat, and a green run on this HEAD means
// verify is not the block. Each branch is the reader's whole decision, so a
// branch removed here must fail here rather than render wrong advice.
assert.equal(classifyVerifyBlockage({ latestRun: null, currentHeadSha: "abc" }).state, "unknown", "no run means unmeasured, never clear");
assert.equal(classifyVerifyBlockage({ latestRun: { exitCode: 1, headSha: "abc" }, currentHeadSha: null }).state, "unknown", "no HEAD means unmeasured");
assert.deepEqual(
  classifyVerifyBlockage({ latestRun: { exitCode: 0, headSha: "abc" }, currentHeadSha: "abc" }),
  { state: "clear", exitCode: 0, runHeadSha: "abc", currentHeadSha: "abc" },
  "green on this HEAD clears verify as the block",
);
assert.equal(
  classifyVerifyBlockage({ latestRun: { exitCode: 1, headSha: "abc" }, currentHeadSha: "abc" }).state,
  "confirmed",
  "red on this exact HEAD will fail again — re-running is futile",
);
assert.equal(
  classifyVerifyBlockage({ latestRun: { exitCode: 1, headSha: "abc" }, currentHeadSha: "def" }).state,
  "stale",
  "red on a moved tree may be stale — re-verify can clear it",
);
assert.equal(
  classifyVerifyBlockage({ latestRun: { exitCode: 0, headSha: "abc" }, currentHeadSha: "def" }).state,
  "stale",
  "even a pass goes stale once the tree moves: done binds verification to an exact HEAD",
);

// The reader: fail-soft and build-only. Every unreadable input reads as
// unknown — an advisory notice must never error the card it explains.
const STUB_CARD = { id: "c1", kind: "build" };
const STUB_RUN = { exit_code: 1, head_sha: "abc" };
const readerFor = ({
  card = STUB_CARD,
  run = STUB_RUN,
  head = "def",
  workspace = { path: "/repo" },
  throwDb = false,
  throwGit = false,
} = {}) => createVerifyBlockageReader({
  db: {
    prepare: () => ({
      get: () => {
        if (throwDb) throw new Error("db gone");
        return run;
      },
    }),
  },
  getCard: () => card,
  cardWorkspace: async () => {
    if (workspace instanceof Error) throw workspace;
    return workspace;
  },
  runGitIn: async () => {
    if (throwGit) throw new Error("git gone");
    return head === null ? { ok: false, stdout: "" } : { ok: true, stdout: `${head}\n` };
  },
});

assert.equal((await readerFor().reportFor("c1")).state, "stale", "red run plus moved tree surfaces through the reader");
assert.equal((await readerFor({ head: "abc" }).reportFor("c1")).state, "confirmed", "same HEAD confirms the failure");
assert.equal((await readerFor({ run: { exit_code: 0, head_sha: "abc" }, head: "abc" }).reportFor("c1")).state, "clear", "green run on this HEAD clears");
assert.equal((await readerFor({ card: { id: "c1", kind: "research" } }).reportFor("c1")).state, "unknown", "research and explore have no suite to go stale");
assert.equal((await readerFor({ card: null }).reportFor("c1")).state, "unknown", "a missing card is unknown, not an error");
assert.equal((await readerFor({ run: null }).reportFor("c1")).state, "unknown", "no recorded run is unknown");
assert.equal((await readerFor({ throwDb: true }).reportFor("c1")).state, "unknown", "a dead database reads as unknown");
assert.equal((await readerFor({ throwGit: true }).reportFor("c1")).state, "unknown", "an unreadable tree reads as unknown");
assert.equal((await readerFor({ workspace: null }).reportFor("c1")).state, "unknown", "no checkout reads as unknown");

// The seam: contract, wiring, registration, and the hero slot. Each pin names
// the integration a deletion would silently break — a notice nobody calls, a
// handler nobody registers, a button with no resume behind it.
const contract = read("server/card-detail-rpc-contract.ts");
assert.match(contract, /verifyBlockage: \{/, "the RPC exists in the card-detail contract");
assert.match(contract, /state: z\.enum\(\["clear", "stale", "confirmed", "unknown"\]\)/, "the contract carries exactly the classifier's states");
const surfaces = read("server/runtime/wiring/card-surfaces.ts");
assert.match(surfaces, /verifyBlockage: buildVerifyBlockage\(core\)/, "the surfaces wire the reader");
assert.match(surfaces, /runGitIn: core\.git\.runGitIn/, "the reader gets its HEAD from the shared git evidence, not a new subprocess of its own");
const rpc = read("server/runtime/wiring/rpc-surfaces.ts");
assert.match(rpc, /verifyBlockage: cards\.verifyBlockage as never/, "the handler is registered on the host");
const hero = read("components/detail/build-detail-hero.tsx");
assert.match(hero, /VerifyBlockageNotice/, "the decision hero mounts the notice");
assert.match(hero, /pendingQuestions\?\.\[0\] \? \(\s*<VerifyBlockageNotice/, "the notice mounts only with open questions — never on a working card");
assert.match(hero, /onResume=\{lifecycle\.doRetry\}/, "resume reuses the existing retry path instead of inventing a second worker wake");
const notice = read("components/detail/verify-blockage-notice.tsx");
assert.match(notice, /rpc\.call\("verifyBlockage", \{ cardId \}\)/, "the notice asks the server instead of re-deriving the rule");
assert.match(
  notice,
  /if \(!report \|\| report\.state === "clear" \|\| report\.state === "unknown"\) return null;/,
  "clear and unknown render nothing: a notice that the block is fine is noise, and an unmeasured block is not a measured absence",
);

console.log("verify blockage test ok: stale failures surface with a resume, confirmed ones refuse the loop");
