import assert from "node:assert/strict";
import test from "node:test";
import { createPlatformHandlers } from "../server/runtime/platform.ts";

function harness(overrides = {}) {
  const calls = [];
  const state = {
    update: { outcome: "current", installed: "0.46.0", installedDisplay: "0.46.0", candidate: null, candidateDisplay: null, detail: null, checkedAt: 10 },
    release: { tag: "v0.46.0", url: "https://example.test/release", checkedAt: 10, newer: false },
  };
  const bb = {
    pluginId: "stelow",
    sdk: {
      plugins: {
        applyUpdate: async () => ({ applied: true, outcome: "updated", detail: null, from: { version: "0.45.0" }, to: { version: "0.46.0" } }),
      },
      providers: {
        list: async () => [{ id: "pi", displayName: "Pi" }, { id: "other", displayName: "Other" }],
        models: async ({ providerId }) => providerId === "pi"
          ? { models: [{ model: "bifrost/harness-coding", displayName: "Harness" }] }
          : { models: [{ model: "other-model", displayName: "Other model" }] },
      },
    },
  };
  const deps = {
    bb,
    pluginDir: "/plugin",
    pluginSkillsDir: "/plugin/skills",
    buildInfo: { version: "0.46.0", builtAt: "2026-09-24T00:00:00Z" },
    readPinnedStelowVersion: () => "0.48.0",
    refreshPluginUpdate: async (force = false) => { calls.push(["refresh", force]); },
    getPluginUpdate: () => state.update,
    getGithubRelease: () => state.release,
    resolveLocalBin: (name) => `/home/test/.local/bin/${name}`,
    homeDir: "/home/test",
    localBinDir: "/home/test/.local/bin",
    preview: {
      view: async (cardId, appOrigin) => ({ cardId, appOrigin }),
      start: async (cardId) => ({ ok: true, cardId }),
      stop: async (cardId) => ({ ok: true, cardId }),
      share: async (cardId) => ({ ok: true, cardId }),
    },
    probeTool: async (bin) => {
      calls.push(["probe", bin]);
      return bin.endsWith("/sg")
        ? { present: true, version: "sg 1.0" }
        : { present: false, version: null };
    },
    runTool: async (command, args) => {
      calls.push(["run", command, args]);
      return { code: command === "curl" ? 1 : 0, out: `${command} failed` };
    },
    ...overrides,
  };
  return { deps, handlers: createPlatformHandlers(deps), calls, state };
}

test("platform status falls through alternate binaries and reports honest misses", async () => {
  const { handlers, calls } = harness();
  const result = await handlers.toolStatus();
  assert.deepEqual(result.tools, [
    { id: "sem", present: false, version: null },
    { id: "ast-grep", present: true, version: "sg 1.0" },
    { id: "cymbal", present: false, version: null },
    { id: "ripwire", present: false, version: null },
  ]);
  const probes = calls.filter(([name]) => name === "probe").map(([, bin]) => bin);
  assert.equal(new Set(probes).size, 5, "each tool candidate is probed once per available binary");
  assert.ok(probes.includes("/home/test/.local/bin/sg"), "the ast-grep fallback binary is probed");
  assert.ok(probes.includes("/home/test/.local/bin/ast-grep"), "the primary ast-grep binary is probed");
});

test("platform build info refreshes state and preserves the configured Pi model list", async () => {
  const { handlers, calls } = harness();
  const info = await handlers.buildInfo();
  assert.equal(info.stelowVersion, "0.48.0");
  assert.equal(info.pluginUpdate.outcome, "current");
  assert.deepEqual(info.skills, []);
  assert.deepEqual(calls[0], ["refresh", false]);

  const models = await handlers.listProviderModels();
  assert.deepEqual(models.providers, [
    { id: "pi", displayName: "Pi", modelsAvailable: true },
    { id: "other", displayName: "Other", modelsAvailable: true },
  ]);
  assert.ok(models.models.some((entry) => entry.model === "bifrost/harness-coding"));
});

test("platform preview handlers delegate to the shared runtime without rebuilding responses", async () => {
  const { handlers } = harness();
  assert.deepEqual(await handlers.previewState({ cardId: "card-1", appOrigin: "http://app" }), {
    cardId: "card-1",
    appOrigin: "http://app",
  });
  assert.deepEqual(await handlers.previewStart({ cardId: "card-1" }), { ok: true, cardId: "card-1" });
  assert.deepEqual(await handlers.previewStop({ cardId: "card-1" }), { ok: true, cardId: "card-1" });
  assert.deepEqual(await handlers.previewShare({ cardId: "card-1" }), { ok: true, cardId: "card-1" });
});

test("tool install dispatch preserves installer-specific failure evidence", async () => {
  const cases = [
    { id: "sem", command: "curl", failure: "Download failed." },
    { id: "ripwire", command: "curl", failure: "Download failed." },
    { id: "ast-grep", command: "npm", failure: "npm install failed." },
    { id: "cymbal", command: "go", failure: "go install failed." },
  ];
  for (const entry of cases) {
    const { handlers, calls } = harness({
      runTool: async (command, args) => {
        calls.push(["run", command, args]);
        return { code: command === entry.command ? 1 : 0, out: "" };
      },
    });
    assert.deepEqual(await handlers.installTool({ id: entry.id }), {
      ok: false,
      version: null,
      log: entry.failure,
    });
  }
});

test("script and binary verification failures remain distinguishable", async () => {
  const installer = harness({
    runTool: async (command) => ({ code: command === "bash" ? 1 : 0, out: "" }),
  });
  assert.deepEqual(await installer.handlers.installTool({ id: "ripwire" }), {
    ok: false,
    version: null,
    log: "\n",
  });

  const verification = harness({
    runTool: async (command) => ({ code: command === "npm" ? 0 : 1, out: "" }),
  });
  assert.deepEqual(await verification.handlers.installTool({ id: "ast-grep" }), {
    ok: false,
    version: null,
    log: "Installed but the binary did not respond.",
  });
});

test("platform exposes the complete public RPC handler set", () => {
  const { handlers } = harness();
  assert.deepEqual(Object.keys(handlers).sort(), [
    "aboutLogo",
    "applyPluginUpdate",
    "buildInfo",
    "checkPluginUpdate",
    "installTool",
    "listProviderModels",
    "previewShare",
    "previewStart",
    "previewState",
    "previewStop",
    "toolStatus",
  ]);
});

console.log("runtime platform test ok: probes, model catalog, update state, and preview delegation");
