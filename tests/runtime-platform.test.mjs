import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlatformHandlers } from "../server/runtime/platform.ts";
import { SCRIPT_INSTALLERS, defaultRun, scriptInstallerEnv } from "../server/runtime/tool-installers.ts";
import { HOST_TOOL_IDS } from "../lib/host-tools.mjs";

function previewHandler(calls, method) {
  return async (cardId, appOrigin) => {
    calls.push(["preview", method, cardId, ...(method === "view" ? [appOrigin] : [])]);
    return method === "view" ? { cardId, appOrigin } : { ok: true, cardId };
  };
}

function platformState() {
  return {
    update: { outcome: "current", installed: "0.46.0", installedDisplay: "0.46.0", candidate: null, candidateDisplay: null, detail: null, checkedAt: 10 },
    release: { tag: "v0.46.0", url: "https://example.test/release", checkedAt: 10, newer: false },
  };
}

function platformHost() {
  return {
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
}

function harness(overrides = {}) {
  const calls = [];
  const state = platformState();
  const deps = {
    bb: platformHost(),
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
      view: previewHandler(calls, "view"),
      start: previewHandler(calls, "start"),
      stop: previewHandler(calls, "stop"),
      share: previewHandler(calls, "share"),
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
    { id: "ast-grep", present: true, version: "sg 1.0" },
    { id: "cymbal", present: false, version: null },
    { id: "ripwire", present: false, version: null },
    { id: "sem", present: false, version: null },
    { id: "xerj", present: false, version: null },
  ], "the probe reports the vocabulary in the panel's order");
  const probes = calls.filter(([name]) => name === "probe").map(([, bin]) => bin);
  assert.equal(new Set(probes).size, 6, "each tool candidate is probed once per available binary");
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
    { id: "xerj", command: "curl", failure: "Download failed." },
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

/**
 * How each installable tool is pinned. This table is the gate, not decoration:
 * the coverage assertion below requires an entry per probed tool, so a tool
 * added to the vocabulary cannot ship without a provenanced install path. The
 * previous version enumerated two ids by hand and a new tool walked past it.
 */
const INSTALL_MECHANISM = {
  sem: {
    kind: "script",
    url: /raw\.githubusercontent\.com\/Ataraxy-Labs\/sem\/v\d+\.\d+\.\d+\//,
  },
  ripwire: {
    kind: "script",
    url: /raw\.githubusercontent\.com\/redhat-et\/ripwire\/v\d+\.\d+\.\d+\//,
  },
  xerj: {
    // No published checksum for the script, so the script's own bytes are the
    // pin — the URL is deliberately unversioned and must stay asserted as such.
    kind: "script",
    url: /^https:\/\/xerj\.org\/get$/,
  },
  "ast-grep": { kind: "package", command: "npm", pinned: "@ast-grep/cli@0.45.3" },
  cymbal: { kind: "package", command: "go", pinned: "github.com/1broseidon/cymbal@v0.17.0" },
};

test("every probed tool declares its install mechanism, and the pin is enforced", async () => {
  const probed = (await harness().handlers.toolStatus()).tools.map((tool) => tool.id);
  assert.deepEqual(
    Object.keys(INSTALL_MECHANISM).sort(),
    [...probed].sort(),
    "the probe set and the provenanced install set are the same set",
  );

  for (const [id, spec] of Object.entries(INSTALL_MECHANISM)) {
    const commands = [];
    const installer = harness({
      runTool: async (command, args) => {
        commands.push({ command, args });
        if (command === "curl") writeFileSync(args.at(-1), "malicious script");
        return { code: spec.kind === "package" && command === spec.command ? 1 : 0, out: "" };
      },
    });
    const result = await installer.handlers.installTool({ id });

    if (spec.kind === "script") {
      assert.equal(result.ok, false, `${id} refuses bytes that do not match its pin`);
      assert.equal(result.log, "Installer SHA-256 mismatch.", `${id} names the refusal`);
      assert.deepEqual(
        commands.map(({ command }) => command),
        ["curl"],
        `${id} never executes an unverified script`,
      );
      assert.match(commands[0].args[3], spec.url, `${id} downloads the pinned script`);
      continue;
    }

    assert.equal(commands[0].command, spec.command, `${id} installs through ${spec.command}`);
    assert.ok(
      commands[0].args.includes(spec.pinned),
      `${id} pins ${spec.pinned} rather than the latest`,
    );
  }
});

test("a pinned script runs with its version, its install directory and a throwaway HOME", () => {
  for (const id of Object.keys(SCRIPT_INSTALLERS)) {
    const env = scriptInstallerEnv(id, { homeDir: "/home/test", localBinDir: "/home/test/.local/bin" }, "/tmp/throwaway");
    const [versionKey] = Object.keys(env).filter((key) => key.endsWith("VERSION"));
    assert.match(versionKey ?? "", /VERSION$/, `${id} names the version it pins`);
    assert.match(env[versionKey], /^v\d+\.\d+\.\d+/, `${id} pins ${versionKey} rather than the latest`);
    assert.ok(
      Object.values(env).some((value) => value.startsWith("/home/test/")),
      `${id} installs where the probe looks, not into the throwaway HOME`,
    );
    assert.equal(env.HOME, "/tmp/throwaway", `${id} runs with a HOME it cannot keep`);
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

test("tool status probes cannot read daemon credentials", async () => {
  const directory = mkdtempSync(join(tmpdir(), "stelow-probe-"));
  const binary = join(directory, "probe");
  const previous = process.env.STELOW_INSTALL_TEST_SECRET;
  process.env.STELOW_INSTALL_TEST_SECRET = "must-not-leak";
  try {
    writeFileSync(binary, [
      `#!${process.execPath}`,
      "process.stdout.write(process.env.STELOW_INSTALL_TEST_SECRET ? 'leaked' : 'probe 1.0')",
    ].join("\n"));
    chmodSync(binary, 0o700);
    const { handlers } = harness({ resolveLocalBin: () => binary, probeTool: undefined });
    const result = await handlers.toolStatus();
    assert.equal(result.tools.length, HOST_TOOL_IDS.length, "the probe reports the whole vocabulary");
    assert.ok(result.tools.every((tool) => tool.version === "probe 1.0"));
  } finally {
    if (previous === undefined) delete process.env.STELOW_INSTALL_TEST_SECRET;
    else process.env.STELOW_INSTALL_TEST_SECRET = previous;
    rmSync(directory, { recursive: true, force: true });
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
      return { code: 0, out: command === "npm" ? "installed" : "ast-grep 0.45.3" };
    },
  });
  assert.deepEqual(await handlers.installTool({ id: "ast-grep" }), {
    ok: true,
    version: "ast-grep 0.45.3",
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
    "agentGraphStatus",
    "applyPluginUpdate",
    "buildInfo",
    "checkPluginUpdate",
    "diagramRendererStatus",
    "enableWorkflowDependency",
    "installTool",
    "installWorkflowDependency",
    "listProviderModels",
    "previewShare",
    "previewStart",
    "previewState",
    "previewStop",
    "registerUiDesignMcp",
    "toolStatus",
    "uiDesignMcpStatus",
    "workflowDependencyStatus",
  ]);
});

console.log("runtime platform test ok: probes, model catalog, update state, and preview delegation");
