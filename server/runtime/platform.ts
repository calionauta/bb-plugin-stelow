import { execFile } from "node:child_process";
import { readdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as nodeJoin } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import { loadAboutLogo } from "../../lib/about-logo.mjs";
import type { rpcContract } from "../rpc-contract.js";

export type PluginUpdateState = {
  outcome: "checking" | "update-available" | "current" | "incompatible" | "pinned" | "unavailable";
  installed: string | null;
  installedDisplay: string | null;
  candidate: string | null;
  candidateDisplay: string | null;
  detail: string | null;
  checkedAt: number | null;
};

export type GithubRelease = {
  tag: string;
  url: string;
  checkedAt: number;
  newer: boolean;
};

export type ToolProbeResult = {
  present: boolean;
  version: string | null;
};

export type ToolRunResult = {
  code: number;
  out: string;
};

type PlatformDeps = {
  bb: BbPluginApi;
  pluginDir: string;
  pluginSkillsDir: string;
  buildInfo: { version: string; builtAt: string | null };
  readPinnedStelowVersion: () => string | null;
  refreshPluginUpdate: (force?: boolean) => Promise<void>;
  getPluginUpdate: () => PluginUpdateState;
  getGithubRelease: () => GithubRelease | null;
  resolveLocalBin: (name: string) => string;
  homeDir: string;
  localBinDir: string;
  preview: {
    view: (cardId: string, appOrigin?: string | null) => Promise<z.infer<typeof rpcContract.previewState.output>>;
    start: (cardId: string) => Promise<z.infer<typeof rpcContract.previewStart.output>>;
    stop: (cardId: string) => Promise<z.infer<typeof rpcContract.previewStop.output>>;
    share: (cardId: string) => Promise<z.infer<typeof rpcContract.previewShare.output>>;
  };
  probeTool?: (bin: string) => Promise<ToolProbeResult>;
  runTool?: (command: string, args: string[], env?: Record<string, string>) => Promise<ToolRunResult>;
};

type RunTool = (command: string, args: string[], env?: Record<string, string>) => Promise<ToolRunResult>;

const PI_BIFROST_PRESET_MODELS = [
  { model: "bifrost/harness-coding", displayName: "Harness Coding (Bifrost)" },
  { model: "bifrost/gpt-5.6-sol", displayName: "GPT-5.6 Sol (ChatGPT via Bifrost)" },
  { model: "bifrost/gpt-5.6-terra", displayName: "GPT-5.6 Terra (ChatGPT via Bifrost)" },
  { model: "bifrost/gpt-5.6-luna", displayName: "GPT-5.6 Luna (ChatGPT via Bifrost)" },
] as const;

const SCRIPT_INSTALLERS = {
  sem: {
    url: "https://raw.githubusercontent.com/Ataraxy-Labs/sem/main/install.sh",
    env: {},
  },
  ripwire: {
    url: "https://raw.githubusercontent.com/redhat-et/ripwire/main/scripts/install.sh",
    env: { RIPWIRE_REPO: "redhat-et/ripwire", RIPWIRE_INSTALL_YES: "1", RIPWIRE_NO_ACTIVATE: "1" },
  },
} as const;

function defaultProbe(bin: string): Promise<ToolProbeResult> {
  return new Promise((resolve) => {
    execFile(bin, ["--version"], { timeout: 8000, maxBuffer: 64 * 1024 }, (error, stdout) => {
      if (!error && typeof stdout === "string" && stdout.trim()) {
        resolve({ present: true, version: stdout.trim().split("\n")[0]?.slice(0, 60) ?? null });
        return;
      }
      resolve({ present: false, version: null });
    });
  });
}

function defaultRun(
  command: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<ToolRunResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: 300000, maxBuffer: 1024 * 1024, env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        const out = `${typeof stdout === "string" ? stdout : ""}\n${typeof stderr === "string" ? stderr : ""}`.trim();
        resolve({ code: error ? 1 : 0, out });
      },
    );
  });
}

function tailLines(value: string): string {
  return value.split("\n").slice(-25).join("\n").slice(-2000);
}

function versionText(value: string): string | null {
  return value.trim().split("\n")[0]?.slice(0, 60) ?? null;
}

function installerBins(deps: PlatformDeps): Record<string, string[]> {
  return {
    sem: [deps.resolveLocalBin("sem")],
    "ast-grep": [deps.resolveLocalBin("ast-grep"), deps.resolveLocalBin("sg")],
    cymbal: [deps.resolveLocalBin("cymbal")],
    ripwire: [deps.resolveLocalBin("ripwire")],
  };
}

async function toolStatus(deps: PlatformDeps): Promise<{ tools: Array<{ id: string } & ToolProbeResult> }> {
  const probe = deps.probeTool ?? defaultProbe;
  const candidates = [
    { id: "sem", bins: [deps.resolveLocalBin("sem")] },
    { id: "ast-grep", bins: [deps.resolveLocalBin("ast-grep"), deps.resolveLocalBin("sg")] },
    { id: "cymbal", bins: [deps.resolveLocalBin("cymbal")] },
    { id: "ripwire", bins: [deps.resolveLocalBin("ripwire")] },
  ];
  const tools = await Promise.all(candidates.map(async ({ id, bins }) => {
    for (const bin of bins) {
      const result = await probe(bin);
      if (result.present) return { id, ...result };
    }
    return { id, present: false, version: null };
  }));
  return { tools };
}

type InstallOutcome = {
  result: ToolRunResult;
  failure: string;
};

async function installScriptTool(
  run: RunTool,
  id: keyof typeof SCRIPT_INSTALLERS,
  tmpPath: string,
): Promise<InstallOutcome> {
  const spec = SCRIPT_INSTALLERS[id];
  const download = await run("curl", ["-fsSL", "--max-time", "120", spec.url, "-o", tmpPath]);
  if (download.code !== 0) return { result: download, failure: "Download failed." };
  const install = await run("bash", [tmpPath], spec.env);
  return {
    result: { code: install.code, out: `${download.out}\n${install.out}` },
    failure: "Installer failed.",
  };
}

async function installNpmTool(run: RunTool, deps: PlatformDeps): Promise<InstallOutcome> {
  const prefix = deps.localBinDir ? nodeJoin(deps.homeDir, ".local") : "";
  const args = ["install", "-g", ...(prefix ? ["--prefix", prefix] : []), "@ast-grep/cli"];
  return { result: await run("npm", args), failure: "npm install failed." };
}

async function installGoTool(run: RunTool, deps: PlatformDeps): Promise<InstallOutcome> {
  const result = await run("go", ["install", "github.com/1broseidon/cymbal@latest"], {
    ...(deps.localBinDir ? { GOBIN: deps.localBinDir } : {}),
    CGO_CFLAGS: "-DSQLITE_ENABLE_FTS5",
  });
  return { result, failure: "go install failed." };
}

async function verifyToolInstall(deps: PlatformDeps, run: RunTool, id: string, log: string) {
  for (const bin of installerBins(deps)[id] ?? []) {
    const check = await run(bin, ["--version"]);
    if (check.code === 0 && check.out.trim()) {
      return { ok: true, version: versionText(check.out), log: tailLines(log) || "Installed." };
    }
  }
  return {
    ok: false,
    version: null,
    log: tailLines(log) || "Installed but the binary did not respond.",
  };
}

async function installTool(deps: PlatformDeps, id: string) {
  const run = deps.runTool ?? defaultRun;
  const tmpPath = nodeJoin(tmpdir(), `.stelow-tool-install-${id}-${process.pid}-${Date.now()}.sh`);
  let log = "";
  try {
    const outcome = id === "sem" || id === "ripwire"
      ? await installScriptTool(run, id, tmpPath)
      : id === "ast-grep"
        ? await installNpmTool(run, deps)
        : await installGoTool(run, deps);
    log = outcome.result.out;
    if (outcome.result.code !== 0) {
      return { ok: false, version: null, log: tailLines(log) || outcome.failure };
    }
  } finally {
    try { unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
  }
  return verifyToolInstall(deps, run, id, log);
}

async function buildInfo(deps: PlatformDeps) {
  await deps.refreshPluginUpdate();
  let skills: string[] = [];
  try {
    skills = readdirSync(deps.pluginSkillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("stelow-"))
      .map((entry) => entry.name)
      .sort();
  } catch { /* the panel shows an empty list */ }
  return {
    version: deps.buildInfo.version,
    builtAt: deps.buildInfo.builtAt,
    stelowVersion: deps.readPinnedStelowVersion(),
    skills,
    pluginUpdate: deps.getPluginUpdate(),
    githubRelease: deps.getGithubRelease(),
  };
}

async function applyPluginUpdate(deps: PlatformDeps) {
  try {
    const result = await deps.bb.sdk.plugins.applyUpdate({ pluginId: deps.bb.pluginId });
    await deps.refreshPluginUpdate(true);
    return {
      applied: result.applied,
      outcome: result.outcome,
      detail: result.detail ?? null,
      from: result.from.version,
      to: result.to?.version ?? null,
    };
  } catch (error) {
    return {
      applied: false,
      outcome: "unavailable" as const,
      detail: error instanceof Error ? error.message : String(error),
      from: null,
      to: null,
    };
  }
}

function createAboutLogoHandler(deps: PlatformDeps) {
  let cached: string | null | undefined;
  return async () => {
    if (cached === undefined) cached = loadAboutLogo(deps.pluginDir);
    return { dataUri: cached ?? null };
  };
}

async function listProviderModels(deps: PlatformDeps) {
  const providers = await deps.bb.sdk.providers.list().catch(() => []);
  const models: Array<{ providerId: string; model: string; displayName: string }> = [];
  const availability = new Map<string, boolean>();
  for (const provider of providers) {
    const result = await deps.bb.sdk.providers.models({ providerId: provider.id }).catch(() => null);
    availability.set(provider.id, result !== null);
    if (provider.id === "pi") {
      const catalog = new Map((result?.models ?? []).map((model) => [model.model, model.displayName]));
      for (const model of PI_BIFROST_PRESET_MODELS) {
        models.push({ providerId: "pi", model: model.model, displayName: catalog.get(model.model) ?? model.displayName });
      }
      continue;
    }
    for (const model of result?.models ?? []) {
      models.push({ providerId: provider.id, model: model.model, displayName: model.displayName });
    }
  }
  return {
    providers: providers.map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      modelsAvailable: availability.get(provider.id) ?? false,
    })),
    models,
  };
}

export function createPlatformHandlers(deps: PlatformDeps) {
  return {
    buildInfo: () => buildInfo(deps),
    applyPluginUpdate: () => applyPluginUpdate(deps),
    checkPluginUpdate: async () => {
      await deps.refreshPluginUpdate(true);
      return { pluginUpdate: deps.getPluginUpdate(), githubRelease: deps.getGithubRelease() };
    },
    aboutLogo: createAboutLogoHandler(deps),
    listProviderModels: () => listProviderModels(deps),
    toolStatus: () => toolStatus(deps),
    installTool: ({ id }: { id: string }) => installTool(deps, id),
    previewState: ({ cardId, appOrigin }: { cardId: string; appOrigin?: string | null }) =>
      deps.preview.view(cardId, appOrigin ?? null),
    previewStart: ({ cardId }: { cardId: string }) => deps.preview.start(cardId),
    previewStop: ({ cardId }: { cardId: string }) => deps.preview.stop(cardId),
    previewShare: ({ cardId }: { cardId: string }) => deps.preview.share(cardId),
  };
}
