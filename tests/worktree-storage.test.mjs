import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { formatBytes, threadIdFromWorktreePath, isStaleEnvironment } from "../lib/worktree-storage.mjs";
import { stelowCliCommands } from "../server/runtime/cli-registry.ts";
import { createStorageCommand } from "../server/runtime/cli/cli-storage.ts";
import { duBytes } from "../server/runtime/cli/du-bytes.ts";

// Bytes format honestly: null reads unknown (never zero), units flip at
// 1024 with one decimal below 100.
assert.equal(formatBytes(0), "0 B", "zero reads zero");
assert.equal(formatBytes(258 * 1024 * 1024), "258 MB", "node_modules-scale reads clean");
assert.equal(formatBytes(1500), "1.5 KB", "small reads decimal");
assert.equal(formatBytes(null), null, "unreadable reads unknown, never zero");
assert.equal(formatBytes(-5), null, "junk reads unknown");
assert.equal(formatBytes("big"), null, "junk reads unknown");

// Thread links come from BB's worktree path convention (thr_<id>); paths
// without one stay unattributed but listed — invisibility is the failure.
assert.equal(threadIdFromWorktreePath("/x/worktrees/thr_vsnnwrr6dw-1/proj"), "thr_vsnnwrr6dw", "thread links extract");
assert.equal(threadIdFromWorktreePath("/home/deploy/repos/x"), null, "plain checkouts stay unattributed");
assert.equal(threadIdFromWorktreePath(null), null, "junk stays unattributed");

// Staleness is display-only: destroyed/teardown phases and past retireAt.
// Live rows read active whatever their age — age alone never condemns.
assert.equal(isStaleEnvironment({ lifecycle: { phase: "destroyed" } }), true, "destroyed reads stale");
assert.equal(isStaleEnvironment({ lifecycle: { phase: "teardown" } }), true, "teardown reads stale");
assert.equal(isStaleEnvironment({ lifecycle: { phase: "active" } }), false, "active reads live");
assert.equal(isStaleEnvironment({ lifecycle: { phase: "active", retireAt: Date.now() - 1000 } }), true, "past retire reads stale");
assert.equal(isStaleEnvironment({ lifecycle: { phase: "active", retireAt: Date.now() + 60_000 } }), false, "future retire reads live");
assert.equal(isStaleEnvironment(null), false, "junk reads live, never condemns");

// The storage readout, driven. Every claim below is asked of the real command
// with a stubbed host registry, not of the source text: read-only registration,
// sizing bounded per path, attribution by thread, unattributed rows that list
// rather than hide, and a readout that never deletes.
const registered = stelowCliCommands.find((entry) => entry.name === "storage");
assert.ok(registered, "the storage command is registered");
assert.match(registered.summary, /read-only/, "the command is registered read-only");

const dir = mkdtempSync(join(tmpdir(), "stelow-storage-"));
writeFileSync(join(dir, "keep.txt"), "x".repeat(2048));
assert.ok((await duBytes(dir)) >= 2048, "sizing a real path reports its bytes");
assert.equal(await duBytes(join(dir, "does-not-exist")), null, "an unreadable path reads unknown, never zero");

let deleted = 0;
const deps = {
  bb: {
    sdk: {
      environments: {
        list: async () => [
          { id: "env_1", isWorktree: true, path: dir, branchName: "main", status: "active", lifecycle: { phase: "active" } },
          { id: "env_plain", isWorktree: false, path: "/not-a-worktree" },
        ],
        delete: () => { deleted += 1; },
      },
    },
  },
  workers: { ledgerCardId: () => null },
  getCard: () => undefined,
};
const command = createStorageCommand(deps);
assert.equal(await command(["other"], {}), null, "the storage family claims exactly its verb");

const json = JSON.parse((await command(["storage", "--json"], {})).stdout);
assert.equal(json.worktrees, 1, "rows come from the host registry, and non-worktrees are skipped");
assert.equal(json.rows[0].path, dir, "the worktree path is reported");
assert.equal(json.rows[0].cardId, null, "a worktree with no ledger card is unattributed, not dropped");
assert.ok(json.totalBytes >= 2048, "the total is carried into the readout");

const text = await command(["storage"], {});
assert.match(text.stdout, /unattributed/, "unattributed rows list instead of hiding");
assert.doesNotMatch(text.stdout, /env_plain/, "a non-worktree row is not listed");
assert.equal(deleted, 0, "the readout never deletes an environment");

console.log("worktree storage test ok: units, links, staleness, driven wiring");
