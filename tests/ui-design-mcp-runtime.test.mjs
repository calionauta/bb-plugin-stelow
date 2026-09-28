import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  binaryOnPath,
  createUiDesignMcpHandlers,
  pinnedVersion,
  readUiDesignMcpStatus,
} from "../server/runtime/ui-design-mcp.ts";

/** A throwaway HOME whose agent-CLI configs we control, plus a PATH we control. */
function fixtureHome(configs) {
  const home = mkdtempSync(join(tmpdir(), "stelow-ui-design-"));
  for (const [relative, body] of Object.entries(configs)) {
    const path = join(home, relative);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, body);
  }
  const binDir = join(home, "bin");
  mkdirSync(binDir, { recursive: true });
  return { home, binDir };
}

function makeBin(binDir, name) {
  writeFileSync(join(binDir, name), "#!/bin/sh\n");
  chmodSync(join(binDir, name), 0o755);
}

/** PATH is the one bin dir; decoys are extra dirs with nothing in them. */
function fakePath(binDir, ...decoys) {
  return [binDir, ...decoys].join(":");
}

const ALL_BB_PROVIDERS = () =>
  Promise.resolve([
    { id: "pi" },
    { id: "acp-opencode" },
    { id: "codex" },
    { id: "claude-code" },
    { id: "acp-cursor" },
  ]);

test("binaryOnPath finds an executable and skips a non-executable", () => {
  const { binDir } = fixtureHome({});
  makeBin(binDir, "claude");
  assert.equal(binaryOnPath("claude", { PATH: fakePath(binDir) }), true);
  assert.equal(binaryOnPath("codex", { PATH: fakePath(binDir) }), false, "a bin that is not there is not found");
  assert.equal(binaryOnPath("claude", { PATH: "" }), false, "an empty PATH finds nothing");
});

test("a config naming the server reports registered for that CLI only", async () => {
  const { home, binDir } = fixtureHome({
    ".claude.json": '{"mcpServers":{"inspo":{"command":"npx"}}}',
    ".config/opencode/opencode.json": '{"mcp":{"bifrost":{"type":"remote"}}}',
  });
  makeBin(binDir, "claude");
  makeBin(binDir, "opencode");
  const status = await readUiDesignMcpStatus(
    { homeDir: home, listProviders: ALL_BB_PROVIDERS },
    { PATH: fakePath(binDir, "claude", "opencode") },
  );
  const inspo = status.servers.find((s) => s.id === "inspo");
  assert.equal(inspo.clients.find((c) => c.client === "claude-code").state, "registered");
  assert.equal(inspo.clients.find((c) => c.client === "opencode").state, "unregistered");
  assert.equal(inspo.usable, 1);
  assert.equal(inspo.state, "ready");
  assert.deepEqual(inspo.missing, ["OpenCode"], "the fix list names the pending CLI");
});

test("a stale config entry does not count when the CLI is off PATH", async () => {
  const { home, binDir } = fixtureHome({
    ".claude.json": '{"mcpServers":{"inspo":{}}}',
  });
  const status = await readUiDesignMcpStatus(
    { homeDir: home, listProviders: ALL_BB_PROVIDERS },
    { PATH: fakePath(binDir) },
  );
  const inspo = status.servers.find((s) => s.id === "inspo");
  assert.equal(inspo.usable, 0, "registration without the binary is not coverage");
  assert.equal(inspo.clients.find((c) => c.client === "claude-code").state, "not-installed");
});

test("a later-installed CLI shows up as pending, not as a silent gap", async () => {
  // The problem this exists for: inspo was registered while only opencode was
  // installed, then claude appeared. Claude must read as "installed, not
  // registered" and be named in the fix list.
  const { home, binDir } = fixtureHome({
    ".config/opencode/opencode.json": '{"mcp":{"inspo":{}}}',
    ".claude.json": "{}",
  });
  makeBin(binDir, "opencode");
  makeBin(binDir, "claude");
  const status = await readUiDesignMcpStatus(
    { homeDir: home, listProviders: ALL_BB_PROVIDERS },
    { PATH: fakePath(binDir, "opencode", "claude") },
  );
  const inspo = status.servers.find((s) => s.id === "inspo");
  assert.equal(inspo.clients.find((c) => c.client === "opencode").state, "registered");
  assert.equal(inspo.clients.find((c) => c.client === "claude-code").state, "unregistered");
  assert.deepEqual(inspo.missing, ["Claude Code"], "the newly installed CLI is named");
});

test("a CLI bb does not offer is not reported as a gap", async () => {
  const { home, binDir } = fixtureHome({ ".cursor/mcp.json": "{}" });
  makeBin(binDir, "cursor");
  const status = await readUiDesignMcpStatus(
    { homeDir: home, listProviders: () => Promise.resolve([{ id: "pi" }]) },
    { PATH: fakePath(binDir, "cursor") },
  );
  const inspo = status.servers.find((s) => s.id === "inspo");
  assert.equal(inspo.clients.find((c) => c.client === "cursor").state, "not-allowed");
  assert.deepEqual(inspo.missing, [], "nothing to fix when bb cannot run the CLI");
});

test("every bb provider this host offers is mapped to a client", async () => {
  const { home, binDir } = fixtureHome({});
  const status = await readUiDesignMcpStatus(
    { homeDir: home, listProviders: ALL_BB_PROVIDERS },
    { PATH: fakePath(binDir) },
  );
  assert.deepEqual(
    status.unmappedProviders,
    [],
    "pi, acp-opencode, codex, claude-code and acp-cursor are all covered by the registry",
  );
  assert.equal(status.bbProviders.length, 5);
});

test("an unmapped bb provider is surfaced rather than silently dropped", async () => {
  const { home, binDir } = fixtureHome({});
  const status = await readUiDesignMcpStatus(
    { homeDir: home, listProviders: () => Promise.resolve([{ id: "pi" }, { id: "brand-new-cli" }]) },
    { PATH: fakePath(binDir) },
  );
  assert.deepEqual(status.unmappedProviders, ["brand-new-cli"], "a Stelow blind spot is named");
});

test("pi's MCP config is read, not assumed absent", async () => {
  const { home, binDir } = fixtureHome({
    ".pi/agent/mcp.json": '{"mcpServers":{"bifrost":{"url":"http://127.0.0.1:8081/mcp"}}}',
  });
  makeBin(binDir, "pi");
  const status = await readUiDesignMcpStatus(
    { homeDir: home, listProviders: ALL_BB_PROVIDERS },
    { PATH: fakePath(binDir, "pi") },
  );
  const inspo = status.servers.find((s) => s.id === "inspo");
  const row = inspo.clients.find((c) => c.client === "pi");
  assert.equal(row.state, "unregistered", "pi is read as a real client with no inspo entry");
  assert.deepEqual(inspo.missing, ["Pi"]);
});

test("jsonc configs parse through the comment stripper", async () => {
  const { home, binDir } = fixtureHome({
    ".config/opencode/opencode.jsonc": '{\n  // the gateway\n  "mcp": { "inspo": {} },\n}\n',
  });
  makeBin(binDir, "opencode");
  const status = await readUiDesignMcpStatus(
    { homeDir: home, listProviders: ALL_BB_PROVIDERS },
    { PATH: fakePath(binDir, "opencode") },
  );
  assert.equal(
    status.servers.find((s) => s.id === "inspo").clients.find((c) => c.client === "opencode").state,
    "registered",
  );
});

test("pinnedVersion reads a version spec and tolerates an unpinned entry", () => {
  assert.equal(pinnedVersion('{"mcp":{"inspo":{"command":"npx","args":["-y","inspo-mcp@0.1.16"]}}}', ["inspo"]), "0.1.16");
  assert.equal(pinnedVersion('{"mcp":{"inspo":{"command":"npx","args":["-y","inspo-mcp"]}}}', ["inspo"]), null, "an unpinned entry has no version to report");
  assert.equal(pinnedVersion("nothing here", ["inspo"]), null);
  assert.equal(pinnedVersion('{"mcp":{"bifrost":{}}}', ["inspo"]), null, "another server's entry is not a match");
});

test("a provider registry that fails to read does not break the panel", async () => {
  const { home, binDir } = fixtureHome({});
  const status = await readUiDesignMcpStatus(
    { homeDir: home, listProviders: () => Promise.reject(new Error("bb unavailable")) },
    { PATH: fakePath(binDir) },
  );
  assert.equal(status.servers.length, 1);
  assert.ok(status.servers.every((s) => Array.isArray(s.missing)), "the fix list still renders");
  assert.deepEqual(status.bbProviders, [], "a failed read reports no providers rather than guessing");
});

test("an unreadable or empty config never throws", async () => {
  const home = mkdtempSync(join(tmpdir(), "stelow-ui-design-empty-"));
  const status = await readUiDesignMcpStatus(
    { homeDir: home, listProviders: ALL_BB_PROVIDERS },
    { PATH: "" },
  );
  assert.equal(status.servers.length, 1);
  assert.ok(status.servers.every((s) => s.usable === 0));
  rmSync(home, { recursive: true, force: true });
});

test("register refuses an unknown server id without spawning anything", async () => {
  const { home, binDir } = fixtureHome({});
  let spawned = false;
  const handlers = createUiDesignMcpHandlers({
    homeDir: home,
    listProviders: ALL_BB_PROVIDERS,
    runRegister: async () => { spawned = true; return { code: 0, out: "" }; },
  });
  const result = await handlers.registerUiDesignMcp({ serverId: "nope" });
  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown design reference MCP/);
  assert.equal(spawned, false, "an unknown id never reaches the installer");
  assert.equal(result.status.servers.length, 1, "status still returned alongside the refusal");
});

test("a successful installer with no resulting registration still reports failure", async () => {
  // The honesty case: the vendor exits 0 but wrote nothing usable. Reporting
  // ok would be a lie the About panel would then show as green.
  const { home, binDir } = fixtureHome({ ".claude.json": "{}" });
  makeBin(binDir, "claude");
  const handlers = createUiDesignMcpHandlers({
    homeDir: home,
    listProviders: ALL_BB_PROVIDERS,
    runRegister: async () => ({ code: 0, out: "done" }),
  });
  const result = await handlers.registerUiDesignMcp({ serverId: "inspo" });
  assert.equal(result.ok, false);
  assert.ok(result.error, "a refusal names what to do next");
  rmSync(home, { recursive: true, force: true });
});

test("only an id in the registry reaches the installer", async () => {
  // The registry carries one server, and it ships a real installer. A vendor
  // whose "installer" is really `npx <pkg> --help` exits 0, prints help, and
  // registers nothing — so such a vendor must never get a row here, and an id
  // outside the registry must never reach a subprocess at all.
  const { home, binDir } = fixtureHome({});
  let spawned = false;
  const handlers = createUiDesignMcpHandlers({
    homeDir: home,
    listProviders: ALL_BB_PROVIDERS,
    runRegister: async () => { spawned = true; return { code: 0, out: "help text" }; },
  });
  const result = await handlers.registerUiDesignMcp({ serverId: "not-a-server" });
  assert.equal(result.ok, false, "an unknown server is refused, not silently run");
  assert.match(result.error, /Unknown design reference MCP/);
  assert.equal(spawned, false, "an unknown id never reaches a subprocess");
});

test("a registering installer that lands a real entry reports ok", async () => {
  const { home, binDir } = fixtureHome({ ".claude.json": "{}" });
  makeBin(binDir, "claude");
  const handlers = createUiDesignMcpHandlers({
    homeDir: home,
    // The CLI this test installs is the one above. Without saying so, the
    // verdict is read from the ambient PATH, and the case passes only on a
    // machine that happens to have that CLI — which is why it went green here
    // and red in CI.
    env: { PATH: fakePath(binDir) },
    listProviders: ALL_BB_PROVIDERS,
    // The installer writes the config as a side effect, exactly as the real
    // one does — the verdict is read back from disk, not from the exit code.
    runRegister: async () => {
      writeFileSync(join(home, ".claude.json"), '{"mcpServers":{"inspo":{}}}');
      return { code: 0, out: "registered" };
    },
  });
  const result = await handlers.registerUiDesignMcp({ serverId: "inspo" });
  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.equal(result.status.servers.find((s) => s.id === "inspo").usable, 1);
  rmSync(home, { recursive: true, force: true });
});
