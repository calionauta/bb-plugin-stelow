import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import plugin, { rpcContract as rootRpcContract } from "../server.ts";
import runtimePlugin from "../server/plugin-runtime.ts";
import { rpcContract } from "../server/rpc-contract.ts";

const root = join(import.meta.dirname, "..");

test("server.ts is a composition root with no upward slice imports", () => {
  const source = readFileSync(join(root, "server.ts"), "utf8");
  assert.ok(source.split("\n").length - 1 <= 600, "composition root stays at or below 600 lines");
  assert.match(source, /plugin-runtime\.js/, "the root wires the runtime entrypoint");
  assert.match(source, /rpc-contract\.js/, "the root exports the canonical RPC surface");
  assert.equal(rootRpcContract, rpcContract, "the root re-exports the canonical contract");

  for (const file of readdirSync(join(root, "server")).filter((name) => name.endsWith(".ts"))) {
    const slice = readFileSync(join(root, "server", file), "utf8");
    assert.doesNotMatch(slice, /from "\.\.\/server(?:\.ts|\.js)"/, `server/${file} does not import upward`);
  }
});

test("runtime composition keeps extracted capabilities wired into registration", () => {
  const source = readFileSync(join(root, "server/plugin-runtime.ts"), "utf8");
  const core = readFileSync(join(root, "server/runtime/runtime-core.ts"), "utf8");
  const reads = readFileSync(join(root, "server/runtime/read-runtime.ts"), "utf8");
  const mentions = readFileSync(join(root, "server/runtime/mentions.ts"), "utf8");
  const wired = source + core + reads;
  assert.match(wired, /createPlatformHandlers\(/, "platform handlers are constructed once");
  assert.equal((source.match(/\.\.\.platform,/g) ?? []).length, 1, "platform handlers are spread into RPC registration once");
  assert.match(wired, /createResearchArtifactRuntime\(/, "research capabilities are constructed");
  for (const symbol of ["researchRoundFiles", "readResearchIndex", "researchReadiness", "exploreArtifact"]) {
    assert.match(wired, new RegExp(`\\b${symbol}\\b`), `${symbol} remains reachable from runtime consumers`);
  }
  assert.match(
    source + mentions,
    /registerMentionProviders\(bb, \{[\s\S]*?db,[\s\S]*?loadBoard: \(projectId\) => loadBoard\(bb, projectId\)[\s\S]*?\}\);/,
    "both mention providers are registered by the runtime composition root",
  );
});

test("the thin root and relocated runtime keep one default plugin entrypoint", () => {
  const rootSource = readFileSync(join(root, "server.ts"), "utf8");
  const runtimeSource = readFileSync(join(root, "server", "plugin-runtime.ts"), "utf8");
  assert.equal(plugin, runtimePlugin, "the root default export is the runtime plugin itself");
  assert.equal((rootSource.match(/export default plugin/g) ?? []).length, 1);
  assert.equal((runtimeSource.match(/export default async function plugin/g) ?? []).length, 1);
});
