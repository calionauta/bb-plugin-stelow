/**
 * The optional host tools: what is present, what is pinned, how it installs.
 *
 * The About panel shows one row per tool and the install verbs live here, so a
 * new tool has exactly one place to be pinned, probed and verified. Three rules
 * hold for every row:
 *
 * - **Pinned.** The plugin installs a version it names — a versioned URL, an
 *   npm/go version, or the installer script's own SHA-256 when upstream
 *   publishes no checksum for the script (xerj). A moved URL is a refused
 *   install, never a silent upgrade.
 * - **Verified.** Success is the binary answering `--version` afterwards, not
 *   the installer's exit code.
 * - **Isolated.** Every install runs with a throwaway HOME and a minimal PATH
 *   (`isolatedToolEnvironment`), so a tool installer never inherits daemon
 *   secrets or the operator's dotfiles.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as nodeJoin } from "node:path";
import { HOST_TOOL_IDS } from "../../lib/host-tools.mjs";

export type ToolProbeResult = {
  present: boolean;
  version: string | null;
};

export type ToolRunResult = {
  code: number;
  out: string;
};

export type RunTool = (
  command: string,
  args: string[],
  env?: Record<string, string>,
) => Promise<ToolRunResult>;

/** What installing and probing actually needs from the composition root. */
export type ToolInstallDeps = {
  resolveLocalBin: (name: string) => string;
  homeDir: string;
  localBinDir: string;
  probeTool?: (bin: string) => Promise<ToolProbeResult>;
  runTool?: RunTool;
};

/**
 * One map from tool to the binaries that satisfy it. The probe set and the
 * install set are the same list, so a tool can never be installable without
 * being reportable (or reported without a way to install it).
 */
const TOOL_BIN_NAMES: Record<string, string[]> = {
  sem: ["sem"],
  "ast-grep": ["ast-grep", "sg"],
  cymbal: ["cymbal"],
  ripwire: ["ripwire"],
  xerj: ["xerj"],
};

/** Installers that ship a shell script. The SHA-256 is the whole pin. */
export const SCRIPT_INSTALLERS = {
  sem: {
    url: "https://raw.githubusercontent.com/Ataraxy-Labs/sem/v0.25.0/install.sh",
    sha256: "a7640dafcfa07c9548558138857f49e1a70a787478952800a5557e5cd7eee370",
    env: { SEM_VERSION: "v0.25.0" },
  },
  ripwire: {
    url: "https://raw.githubusercontent.com/redhat-et/ripwire/v0.6.4/scripts/install.sh",
    sha256: "dfc76bc9bdf97fb04f29683703fe931db885afadca056e98364c634874726d55",
    env: {
      RIPWIRE_REPO: "redhat-et/ripwire",
      RIPWIRE_VERSION: "v0.6.4",
      RIPWIRE_INSTALL_YES: "1",
      RIPWIRE_NO_ACTIVATE: "1",
    },
  },
  /**
   * xerj publishes no checksum for `https://xerj.org/get`, so the URL cannot be
   * the pin: the script's own bytes are. `XERJ_VERSION` pins the binary the
   * script resolves, and the script verifies that binary against the
   * `.sha256` published beside each release asset — fail-closed. When upstream
   * edits the script, this install refuses rather than adopting the new bytes;
   * bumping the pin means re-hashing the script and naming the new release.
   */
  xerj: {
    url: "https://xerj.org/get",
    sha256: "b60ad56ed11d4a42fe76d42da2e850a57ae5e53fb7c7c418b7e2d962f18858f4",
    env: { XERJ_VERSION: "v1.0.0-rc.96" },
  },
} as const;

const AST_GREP_VERSION = "0.45.3";
const CYMBAL_VERSION = "v0.17.0";

export function isolatedToolEnvironment(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    HOME: overrides.HOME ?? tmpdir(),
    PATH: "/usr/local/bin:/usr/bin:/bin",
    TMPDIR: overrides.HOME ?? tmpdir(),
    ...overrides,
  };
}

export function defaultRun(
  command: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<ToolRunResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: 300000, maxBuffer: 1024 * 1024, env: isolatedToolEnvironment(env) },
      (error, stdout, stderr) => {
        const out = `${typeof stdout === "string" ? stdout : ""}\n${typeof stderr === "string" ? stderr : ""}`.trim();
        resolve({ code: error ? 1 : 0, out });
      },
    );
  });
}

function defaultProbe(bin: string): Promise<ToolProbeResult> {
  return new Promise((resolve) => {
    execFile(bin, ["--version"], { timeout: 8000, maxBuffer: 64 * 1024, env: isolatedToolEnvironment() }, (error, stdout) => {
      if (!error && typeof stdout === "string" && stdout.trim()) {
        resolve({ present: true, version: stdout.trim().split("\n")[0]?.slice(0, 60) ?? null });
        return;
      }
      resolve({ present: false, version: null });
    });
  });
}

function tailLines(value: string): string {
  return value.split("\n").slice(-25).join("\n").slice(-2000);
}

function versionText(value: string): string | null {
  return value.trim().split("\n")[0]?.slice(0, 60) ?? null;
}

function installerBins(deps: ToolInstallDeps): Record<string, string[]> {
  const resolved: Record<string, string[]> = {};
  for (const [id, names] of Object.entries(TOOL_BIN_NAMES)) {
    resolved[id] = names.map((name) => deps.resolveLocalBin(name));
  }
  return resolved;
}

export async function toolStatus(
  deps: ToolInstallDeps,
): Promise<{ tools: Array<{ id: string } & ToolProbeResult> }> {
  const probe = deps.probeTool ?? defaultProbe;
  const bins = installerBins(deps);
  const candidates = HOST_TOOL_IDS.map((id) => ({ id, bins: bins[id] ?? [] }));
  const tools = await Promise.all(candidates.map(async ({ id, bins: names }) => {
    for (const bin of names) {
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
  deps: ToolInstallDeps,
  id: keyof typeof SCRIPT_INSTALLERS,
  tmpPath: string,
): Promise<InstallOutcome> {
  const spec = SCRIPT_INSTALLERS[id];
  const download = await run("curl", ["-fsSL", "--max-time", "120", spec.url, "-o", tmpPath]);
  if (download.code !== 0) return { result: download, failure: "Download failed." };
  let digest: string;
  try {
    digest = createHash("sha256").update(readFileSync(tmpPath)).digest("hex");
  } catch {
    return { result: { code: 1, out: "Installer download is missing." }, failure: "Verification failed." };
  }
  if (digest !== spec.sha256) {
    return { result: { code: 1, out: "Installer SHA-256 mismatch." }, failure: "Verification failed." };
  }
  const install = await run("bash", [tmpPath], scriptInstallerEnv(id, deps, nodeJoin(tmpPath, "..")));
  return {
    result: { code: install.code, out: `${download.out}\n${install.out}` },
    failure: "Installer failed.",
  };
}

/**
 * The environment a pinned script runs with: the pin's own variables, a
 * throwaway HOME, and the install location the tool needs. Pure, so the pin can
 * be asserted without a network — the hash gate above is the only part that
 * needs bytes.
 */
export function scriptInstallerEnv(
  id: keyof typeof SCRIPT_INSTALLERS,
  deps: Pick<ToolInstallDeps, "homeDir" | "localBinDir">,
  home: string,
): Record<string, string> {
  return { ...SCRIPT_INSTALLERS[id].env, HOME: home, ...installDirEnv(id, deps) };
}

/** Where each script installer puts the binary; they disagree on the shape. */
function installDirEnv(
  id: keyof typeof SCRIPT_INSTALLERS,
  deps: Pick<ToolInstallDeps, "homeDir" | "localBinDir">,
): Record<string, string> {
  if (id === "sem") return { SEM_INSTALL_DIR: deps.localBinDir };
  if (id === "xerj") return { XERJ_INSTALL_DIR: deps.localBinDir };
  return { RIPWIRE_INSTALL_PREFIX: nodeJoin(deps.homeDir, ".local") };
}

async function installNpmTool(run: RunTool, deps: ToolInstallDeps): Promise<InstallOutcome> {
  const prefix = deps.localBinDir ? nodeJoin(deps.homeDir, ".local") : "";
  const args = ["install", "-g", ...(prefix ? ["--prefix", prefix] : []), `@ast-grep/cli@${AST_GREP_VERSION}`];
  return { result: await run("npm", args), failure: "npm install failed." };
}

async function installGoTool(run: RunTool, deps: ToolInstallDeps): Promise<InstallOutcome> {
  const result = await run("go", ["install", `github.com/1broseidon/cymbal@${CYMBAL_VERSION}`], {
    ...(deps.localBinDir ? { GOBIN: deps.localBinDir } : {}),
    CGO_CFLAGS: "-DSQLITE_ENABLE_FTS5",
  });
  return { result, failure: "go install failed." };
}

async function verifyToolInstall(
  deps: ToolInstallDeps,
  run: RunTool,
  id: string,
  log: string,
) {
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

export async function installTool(deps: ToolInstallDeps, id: string) {
  if (!(HOST_TOOL_IDS as readonly string[]).includes(id)) {
    return { ok: false, version: null, log: `Unknown tool: ${id}` };
  }
  const baseRun = deps.runTool ?? defaultRun;
  const tempDir = mkdtempSync(nodeJoin(tmpdir(), "stelow-tool-install-"));
  const run: RunTool = (command, args, env) => baseRun(command, args, {
    ...env,
    HOME: env?.HOME ?? tempDir,
  });
  try {
    const tmpPath = nodeJoin(tempDir, "install.sh");
    const outcome = id in SCRIPT_INSTALLERS
      ? await installScriptTool(run, deps, id as keyof typeof SCRIPT_INSTALLERS, tmpPath)
      : id === "ast-grep"
        ? await installNpmTool(run, deps)
        : await installGoTool(run, deps);
    const log = outcome.result.out;
    if (outcome.result.code !== 0) {
      return { ok: false, version: null, log: tailLines(log) || outcome.failure };
    }
    return await verifyToolInstall(deps, run, id, log);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
