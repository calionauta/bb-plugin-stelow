import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, writeFileSync } from "node:fs";
import { createPlatformHandlers, defaultRun } from "../server/runtime/platform.ts";

function harness(overrides = {}) {
  const calls = [];
  const previewHandler = (method) => async (cardId, appOrigin) => {
    calls.push(["preview", method, cardId, ...(method === "view" ? [appOrigin] : [])]);
    return method === "view" ? { cardId, appOrigin } : { ok: true, cardId };
  };
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
      view: previewHandler("view"),
      start: previewHandler("start"),
      stop: previewHandler("stop"),
      share: previewHandler("share"),
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
  const { handlers, calls } = harness();
  assert.deepEqual(await handlers.previewState({ cardId: "card-1", appOrigin: "http://app" }), {
    cardId: "card-1",
    appOrigin: "http://app",
  });
  assert.deepEqual(await handlers.previewStart({ cardId: "card-1" }), { ok: true, cardId: "card-1" });
  assert.deepEqual(await handlers.previewStop({ cardId: "card-1" }), { ok: true, cardId: "card-1" });
  assert.deepEqual(await handlers.previewShare({ cardId: "card-1" }), { ok: true, cardId: "card-1" });
  assert.deepEqual(calls, [
    ["preview", "view", "card-1", "http://app"],
    ["preview", "start", "card-1"],
    ["preview", "stop", "card-1"],
    ["preview", "share", "card-1"],
  ]);
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
    runTool: async (command, args) => {
      if (command === "curl") writeFileSync(args.at(-1), "unverified installer");
      return { code: 0, out: "" };
    },
  });
  assert.deepEqual(await installer.handlers.installTool({ id: "ripwire" }), {
    ok: false,
    version: null,
    log: "Installer SHA-256 mismatch.",
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

test("installer provenance refuses modified scripts before execution and pins package versions", async () => {
  for (const id of ["sem", "ripwire"]) {
    const commands = [];
    const { handlers } = harness({
      runTool: async (command, args) => {
        commands.push([command, args]);
        if (command === "curl") writeFileSync(args.at(-1), "malicious script");
        return { code: 0, out: "" };
      },
    });
    assert.equal((await handlers.installTool({ id })).ok, false);
    assert.deepEqual(commands.map(([command]) => command), ["curl"]);
    assert.match(commands[0][1][3], /\/v\d+\.\d+\.\d+\//);
  }

  for (const [id, command, version] of [
    ["ast-grep", "npm", "@ast-grep/cli@0.40.3"],
    ["cymbal", "go", "github.com/1broseidon/cymbal@v0.17.0"],
  ]) {
    const commands = [];
    const { handlers } = harness({
      runTool: async (name, args) => {
        commands.push([name, args]);
        return { code: 1, out: "" };
      },
    });
    await handlers.installTool({ id });
    assert.equal(commands[0][0], command);
    assert.ok(commands[0][1].includes(version));
  }
});

test("subprocess runner passes an explicit environment without daemon secrets", async () => {
  const secret = process.env.STELOW_INSTALL_TEST_SECRET;
  process.env.STELOW_INSTALL_TEST_SECRET = "must-not-leak";
  try {
    const result = await defaultRun(process.execPath, [
      "-e",
      "process.stdout.write(JSON.stringify(process.env))",
    ]);
    assert.equal(result.code, 0);
    const childEnv = JSON.parse(result.out);
    assert.equal(childEnv.STELOW_INSTALL_TEST_SECRET, undefined);
    assert.equal(childEnv.PATH, "/usr/local/bin:/usr/bin:/bin");
    assert.notEqual(childEnv.HOME, process.env.HOME);
    assert.equal(childEnv.TMPDIR, childEnv.HOME);
  } finally {
    if (secret === undefined) delete process.env.STELOW_INSTALL_TEST_SECRET;
    else process.env.STELOW_INSTALL_TEST_SECRET = secret;
  }
});

test("every install command receives an isolated home that is removed afterward", async () => {
  for (const id of ["sem", "ripwire", "ast-grep", "cymbal"]) {
    const commands = [];
    const { handlers } = harness({
      runTool: async (command, args, env) => {
        commands.push({ command, args, env });
        return { code: 1, out: "" };
      },
    });
    await handlers.installTool({ id });
    assert.equal(commands.length, 1);
    assert.notEqual(commands[0].env.HOME, process.env.HOME);
    assert.match(commands[0].env.HOME, /stelow-tool-install-/);
    assert.equal(existsSync(commands[0].env.HOME), false);
  }
});

test("verification runs inside the private install directory before cleanup", async () => {
  const commands = [];
  const { handlers } = harness({
    runTool: async (command, args, env) => {
      commands.push({ command, args, env });
      assert.equal(existsSync(env.HOME), true);
      return { code: 0, out: command === "npm" ? "installed" : "ast-grep 0.40.3" };
    },
  });
  assert.deepEqual(await handlers.installTool({ id: "ast-grep" }), {
    ok: true,
    version: "ast-grep 0.40.3",
    log: "installed",
  });
  assert.equal(commands.length, 2);
  assert.equal(commands[0].env.HOME, commands[1].env.HOME);
  assert.equal(existsSync(commands[0].env.HOME), false);
});

test("unknown tool IDs never dispatch an installer", async () => {
  const { handlers, calls } = harness();
  assert.deepEqual(await handlers.installTool({ id: "unexpected" }), {
    ok: false,
    version: null,
    log: "Unknown tool: unexpected",
  });
  assert.deepEqual(calls, []);
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
