import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { formatBytes, threadIdFromWorktreePath, isStaleEnvironment } from "../lib/worktree-storage.mjs";

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

// Wiring pins: the storage readout is read-only, bounded per path,
// attributed by thread, and registered beside metrics.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = [
  readFileSync(join(root, "server/plugin-runtime.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/cli-registry.ts"), "utf8"),
].join("\n");
assert.match(server, /command\("storage", "[^"]*read-only/, "the command is registered read-only");
assert.match(server, /if \(argv\[0\] === "storage"\) \{/, "the storage branch exists");
assert.match(server, /bb\.sdk\.environments\s*\n\s*\.list\(\)/, "rows come from the host registry, never a hand scan");
assert.match(server, /unattributed/, "unattributed rows list instead of hiding");
assert.match(server, /timeout: 8000/, "sizing is bounded per path");
assert.doesNotMatch(server, /environments\.delete\(/, "the readout never deletes");

console.log("worktree storage test ok: units, links, staleness, wiring");
