import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Fresh-context spawn contract (mirrors upstream cli-tools/subagents.md:
// fresh is non-negotiable, fork is fallback only). Every thread the host
// spawns starts empty; context travels inside the prompt, never as an
// inherited history. A seventh spawn site, a fork-family parameter, or a
// history-carrying prompt builder fails here first — consciously update
// this file when the spawn topology legitimately changes.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server.ts"), "utf8");

// Six spawn sites, no more, no fewer: initial worker, restart, automation
// draft, reseed, reviewer, draft burst. The two disposables (reviewer, draft
// burst) spawn through the lifecycle helper, so the count below separates
// direct worker spawns from helper-routed disposables. A new spawn site is a
// new brain with its own lifecycle — it must arrive with a tier decision here.
assert.equal(
  (server.match(/bb\.sdk\.threads\.spawn\(\{/g) ?? []).length,
  4,
  "four direct worker spawns pinned; a fifth updates this contract deliberately",
);
assert.equal(
  (server.match(/await spawnDisposable\(\{/g) ?? []).length,
  2,
  "two disposable spawns pinned; a third updates this contract deliberately",
);

// The SDK surface has no history inheritance today — keep it that way. If a
// future SDK adds fork/resume parameters, using one inside a spawn block
// must trip this test before it ships silently. (parentThreadId exists only
// as a threads.list filter for child-thread observability — listing, never
// inheritance — so it is scoped out of this ban.)
for (const token of ["resumeThread", "continueFromThread", "forkThread", "inheritHistory", "forkHistory"]) {
  assert.ok(!server.includes(token), `no fork-family parameter (${token}) anywhere near spawning`);
}
for (const match of server.matchAll(/bb\.sdk\.threads\.spawn\(\{/g)) {
  const block = server.slice(match.index, match.index + 1500);
  for (const token of ["parentThreadId", "resumeThread", "continueFromThread", "forkThread", "inheritHistory", "parent:"]) {
    assert.ok(!block.includes(token), `spawn block inherits no history (${token})`);
  }
}
// Disposable blocks route through the helper: same history bans. The helper
// itself owns the only other spawn calls (with-owner, then the strict-host
// fallback without) — lifecycle ownership travels there, never history.
for (const match of server.matchAll(/await spawnDisposable\(\{/g)) {
  const block = server.slice(match.index, match.index + 900);
  for (const token of ["parentThreadId", "resumeThread", "continueFromThread", "forkThread", "inheritHistory", "parent:"]) {
    assert.ok(!block.includes(token), `disposable spawn block inherits no history (${token})`);
  }
}

// previousThreadId is a reference string, never a spawn identity: it is
// rendered into prompts beside an explicit `bb thread output` retrieval,
// passed through builders, nulled at initial spawn, or archived/stopped.
// It is never handed to spawn as the new thread's parent.
for (const line of server.split("\n")) {
  if (!line.includes("previousThreadId")) continue;
  const allowed = line.includes("bb thread output")
    || line.includes("Previous worker thread:")
    || line.includes("previousThreadId: null")
    || line.includes("previousThreadId,")
    || line.includes("previousThreadId }")
    || line.includes("const previousThreadId = card.worker_thread_id")
    || line.includes("previousThreadId: row.worker_thread_id")
    || line.includes("previousThreadId: string | null")
    || line.includes("previousThreadId, roundNo")
    || line.includes("if (previousThreadId) {");
  assert.ok(allowed, `previousThreadId only as reference/plumbing, never identity: ${line.trim().slice(0, 120)}`);
}

// Disposable spawns build their prompt through the leashed lib builders —
// the leash (no files, no commands, no questions) is tested where it lives,
// and this pins the wiring: no hand-rolled draft/review prompt may bypass it.
assert.match(server, /buildReviewPrompt\(\{ cardName:/, "review prompts go through the lib builder");
assert.match(server, /buildDraftPrompt\(\{ cardName:/, "draft prompts go through the lib builder");
for (const name of ["reviewThread = await spawnDisposable({", "draftThread = await spawnDisposable({"]) {
  const at = server.indexOf(name);
  assert.ok(at >= 0, `${name} exists`);
  assert.ok(server.slice(at, at + 600).includes('visibility: "hidden"'), "disposable spawns stay hidden");
  assert.ok(server.slice(at, at + 900).includes("lifecycleOwnerThreadId: card.worker_thread_id"), "disposable spawns die with their worker (dependent lifecycle)");
}
// lifecycleOwnerThreadId is lifecycle, never history: the bans above (parent,
// fork, resume inside spawn blocks) still stand untouched.
// Older daemons that reject the field instead of stripping it get one retry
// without it, so disposables never break on strict hosts.
assert.match(server, /async function spawnDisposable\(args: SpawnArgs\)/, "disposable spawns go through the lifecycle helper");
assert.match(server, /unrecognized key\/i\.test\(message\)/, "an unrecognized-field rejection retries once without the owner");

// The owner rule teaches fresh delegation: full task in the call, never a
// fork, never sibling chatter.
assert.match(server, /Delegate fresh: package the full task in the call itself/, "CARD_OWNER_RULES teaches fresh delegation");

console.log("spawn freshness test ok: six spawns, no fork path, leashed builders, fresh rule taught");
