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
  // 400 is the repository's file budget (scripts/check-source-budgets.mjs).
  // A looser number here would let the entrypoint regrow unnoticed.
  assert.ok(source.split("\n").length - 1 <= 400, "composition root stays within the file budget");
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
  const hostWiring = readFileSync(
    join(root, "server/runtime/wiring/host-surfaces.ts"),
    "utf8",
  );
  const registry = readFileSync(
    join(root, "server/runtime/wiring/rpc-surfaces.ts"),
    "utf8",
  );
  const cardWiring = readFileSync(
    join(root, "server/runtime/wiring/card-surfaces.ts"),
    "utf8",
  );
  const cliWiring = readFileSync(
    join(root, "server/runtime/wiring/cli-surfaces.ts"),
    "utf8",
  );
  const wired = source + core + reads + hostWiring + cardWiring + cliWiring;
  assert.match(wired, /createPlatformHandlers\(/, "platform handlers are constructed once");
  assert.equal((registry.match(/\.\.\.host\.platform,/g) ?? []).length, 1, "platform handlers are spread into RPC registration once");
  assert.match(wired, /createResearchArtifactRuntime\(/, "research capabilities are constructed");
  for (const symbol of ["researchRoundFiles", "readResearchIndex", "researchReadiness", "exploreArtifact"]) {
    assert.match(wired, new RegExp(`\\b${symbol}\\b`), `${symbol} remains reachable from runtime consumers`);
  }
  assert.match(
    hostWiring,
    /registerMentionProviders\([\s\S]*?db:[\s\S]*?loadBoard: \(projectId\) => [\s\S]*?\}\);/,
    "both mention providers are registered by the host wiring layer",
  );
  assert.match(mentions, /export function registerMentionProviders\(/, "the mention providers still have one owner");
});

// The layers are wired in dependency order, and nothing reaches back up. The
// boundary seam is in that list because it IS a construction order: the answer
// doors need the execution layer's port, and the execution layer needs the
// gates' question contract, so the seam is created before either of them.
function assertWiringOrder(source) {
  const order = [
    "createRuntimeCore(bb)",
    "deferred<AnswerBoundaryPort>()",
    "createGateSurfaces({ core, boundary })",
    "createExecutionSurfaces({ core, gates, boundary })",
    "createCardSurfaces({",
    "createHostSurfaces({ core, cards, github: github.bind })",
    "registerStelowRpc({",
    "registerStelowCommand({",
  ];
  let cursor = -1;
  for (const step of order) {
    const at = source.indexOf(step, cursor + 1);
    assert.ok(at > cursor, `the root assembles ${step} after the layer it depends on`);
    cursor = at;
  }
  assert.match(
    source,
    /const boundary = deferred<AnswerBoundaryPort>\(\);\n\s*const gates = createGateSurfaces/,
    "the seam is created before the layer that reads it, not after",
  );
}

test("the composition root only assembles; no surface is built inside it", () => {
  const source = readFileSync(join(root, "server/plugin-runtime.ts"), "utf8");
  for (const factory of [
    "createCardsServer",
    "createPlatformHandlers",
    "createGithubAutomation",
    "createCardDetailHandler",
    "registerRpcHandlers",
    "registerStelowCli",
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`${factory}\\(`),
      `${factory} is wired by a layer, not by the composition root`,
    );
  }
  assertWiringOrder(source);

  // A fallback constant parked here is how a shape drifts into a second copy:
  // the root once held the "GitHub is not there" status beside its wiring.
  const moduleLevel = [...source.matchAll(/^(?:const|let|function|class)\s+(\w+)/gm)]
    .map((match) => match[1]);
  assert.deepEqual(
    moduleLevel,
    [],
    "the root declares no module-level value: a constant here is behavior that belongs to a layer",
  );
});

test("the thin root and relocated runtime keep one default plugin entrypoint", () => {
  const rootSource = readFileSync(join(root, "server.ts"), "utf8");
  const runtimeSource = readFileSync(join(root, "server", "plugin-runtime.ts"), "utf8");
  assert.equal(plugin, runtimePlugin, "the root default export is the runtime plugin itself");
  assert.equal((rootSource.match(/export default plugin/g) ?? []).length, 1);
  assert.equal((runtimeSource.match(/export default async function plugin/g) ?? []).length, 1);
});
