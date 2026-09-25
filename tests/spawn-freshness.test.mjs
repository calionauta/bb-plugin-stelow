import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Fresh-context spawn contract (mirrors upstream cli-tools/subagents.md:
// fresh is non-negotiable, fork is fallback only). Every thread the host
// spawns starts empty; context travels inside the prompt, never as an
// inherited history. A seventh spawn site, a fork-family parameter, or a
// history-carrying prompt builder fails here first — consciously update
// this file when the spawn topology legitimately changes.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = readFileSync(join(root, "server/plugin-runtime.ts"), "utf8");
const drafting = readFileSync(join(root, "server", "drafting.ts"), "utf8");
const presetJudge = readFileSync(join(root, "server/decisions/preset-judge-runner.ts"), "utf8");
const reviewPreflight = readFileSync(join(root, "server/review-preflight.ts"), "utf8");
const workerBackend = readdirSync(join(root, "server"))
  .filter((file) => /^workers.*\.ts$/.test(file))
  .sort()
  .map((file) => readFileSync(join(root, "server", file), "utf8"))
  .join("\n");
const reviewCli = readFileSync(join(root, "server/runtime/cli/cli-review.ts"), "utf8");
const spawnSources = `${server}\n${drafting}\n${presetJudge}\n${reviewPreflight}\n${reviewCli}\n${workerBackend}`;

// One worker SDK spawn, one preset-judge spawn, and two fallback calls inside
// the disposable helper remain. All card-worker paths use the worker seam.
assert.equal(
  (spawnSources.match(/bb\.sdk\.threads\.spawn\(/g) ?? []).length,
  4,
  "the worker seam, preset judge, and two disposable-helper calls are pinned",
);
assert.equal(
  (workerBackend.match(/bb\.sdk\.threads\.spawn\(/g) ?? []).length,
  1,
  "the worker slice has one SDK spawn implementation",
);
assert.doesNotMatch(server, /delegation-site: worker-spawn/, "server.ts owns no direct worker spawn");
assert.equal(
  (spawnSources.match(/(?:await )?(?:deps\.)?spawnDisposable\(\s*(?:\{|[\w.]+\()/g) ?? []).length,
  4,
  "four disposable spawns pinned (review, draft, card-title, gate pre-review); a fifth updates this contract deliberately",
);

// The SDK surface has no history inheritance today — keep it that way. If a
// future SDK adds fork/resume parameters, using one inside a spawn block
// must trip this test before it ships silently. (parentThreadId exists only
// as a threads.list filter for child-thread observability — listing, never
// inheritance — so it is scoped out of this ban.)
for (const token of ["resumeThread", "continueFromThread", "forkThread", "inheritHistory", "forkHistory"]) {
  assert.ok(!spawnSources.includes(token), `no fork-family parameter (${token}) anywhere near spawning`);
}
for (const match of spawnSources.matchAll(/workers\.spawn\(\{|bb\.sdk\.threads\.spawn\(/g)) {
  const block = spawnSources.slice(match.index, match.index + 1500);
  for (const token of ["parentThreadId", "resumeThread", "continueFromThread", "forkThread", "inheritHistory", "parent:"]) {
    assert.ok(!block.includes(token), `spawn block inherits no history (${token})`);
  }
}
// Disposable blocks route through the helper: same history bans. The helper
// itself owns the only other spawn calls (with-owner, then the strict-host
// fallback without) — lifecycle ownership travels there, never history.
for (const match of spawnSources.matchAll(/(?:await )?(?:deps\.)?spawnDisposable\(\s*\{/g)) {
  const block = spawnSources.slice(match.index, match.index + 900);
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
    || line.trim() === "previousThreadId"
    || line.includes("}, previousThreadId)")
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
assert.match(reviewCli, /buildReviewPrompt\(\{\s*cardName:/, "review prompts go through the lib builder");
assert.match(drafting, /buildDraftPrompt\(\{\s*cardName:/, "draft prompts go through the lib builder");
for (const [source, name] of [
  [reviewCli, "const thread = await deps.spawnDisposable("],
  [drafting, "return deps.spawnDisposable("],
]) {
  const at = source.indexOf(name);
  assert.ok(at >= 0, `${name} exists`);
  assert.ok(
    source.slice(at, at + 600).includes('visibility: "hidden"') ||
      // The review site builds its args in a named helper next to the call;
      // the helper is the one that must keep the reviewer hidden.
      source.includes('reviewSpawnArgs(card, prompt, params, environment)') &&
        source.includes('visibility: "hidden" as const'),
    "disposable spawns stay hidden",
  );
}
assert.ok(
  reviewPreflight.includes("const preThread = await deps.spawnDisposable("),
  "gate pre-review uses the disposable seam",
);
assert.ok(reviewPreflight.includes('visibility: "hidden" as const'), "gate pre-review stays hidden");
assert.ok(drafting.includes("lifecycleOwnerThreadId: card.worker_thread_id"), "drafts die with their worker");
assert.match(drafting, /return deps\.spawnDisposable\(\s*\{/, "drafting owns delegated draft spawns");
// Card titles are ownerless by design: they need no worker, and the
// rename-guard plus silent failure cover every race — an owner link would
// add lifecycle without meaning.
const titleAt = drafting.indexOf(
  "return deps.spawnDisposable(",
  drafting.indexOf("async function spawnTitle"),
);
assert.ok(titleAt >= 0, "titling rides the disposable path as a registered site");
assert.ok(drafting.slice(titleAt, titleAt + 600).includes('visibility: "hidden"'), "title spawns stay hidden");
assert.ok(drafting.slice(titleAt, titleAt + 1200).includes('"card-title"'), "title spawns name their registry site");
// lifecycleOwnerThreadId is lifecycle, never history: the bans above (parent,
// fork, resume inside spawn blocks) still stand untouched.
// Older daemons that reject the field instead of stripping it get one retry
// without it, so disposables never break on strict hosts.
assert.match(
  server,
  /async function spawnDisposable\(\s*args: SpawnArgs,\s*site: string,/,
  "disposable spawns go through the registry-validated helper",
);
assert.match(server, /unrecognized key\/i\.test\(message\)/, "an unrecognized-field rejection retries once without the owner");

// The owner rule teaches fresh delegation: full task in the call, never a
// fork, never sibling chatter.
assert.match(server, /Delegate fresh: package the full task in the call itself/, "CARD_OWNER_RULES teaches fresh delegation");

console.log("spawn freshness test ok: worker seam and judge pinned, no fork path, leashed builders, fresh rule taught");
