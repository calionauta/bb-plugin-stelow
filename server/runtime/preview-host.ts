/**
 * The host side of preview: spawning a dev server and asking bb Connect.
 *
 * The lifecycle — which checkout owns a server, when it is ready, what to
 * clean up — lives in lib/preview-runtime with a node test, per AGENTS.md
 * (`lib/` owns state logic; never inline-only in server.ts handlers). What
 * stays here is only what the host must provide: reading files, listing a
 * directory, spawning the process, and asking Connect.
 *
 * A reload or disable must not leave a dev server running behind the user's
 * back: the processes are ours, so shutting them down is ours too.
 */
import { execFile, spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join as nodeJoin } from "node:path";
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { createPreviewRuntime } from "../../lib/preview-runtime.mjs";
import { registerPreviewDisposal } from "./composition.js";

/** Run a command and report its exit code and combined output. */
function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolveRun) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        env: { ...(process.env as Record<string, string>) },
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === "number"
            ? (error as { code: number }).code
            : error
              ? 1
              : 0;
        resolveRun({ code, out: `${stdout ?? ""}${stderr ?? ""}` });
      },
    );
  });
}

/**
 * `bb connect <args> --json`, parsed. Connect is the sanctioned surface for
 * exposing a port (`share-server-links`), so this is the whole client: null
 * means unpaired, unsupported, or unparseable, and every caller falls back to
 * the next rung rather than guessing at a shape it does not recognize.
 */
async function runConnect(
  resolveLocalBin: (name: string) => string,
  args: string[],
): Promise<Record<string, unknown> | null> {
  const result = await runCommand(resolveLocalBin("bb"), [
    "connect",
    ...args,
    "--json",
  ]).catch(() => null);
  if (!result || result.code !== 0) return null;
  const match = result.out.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function createPreviewHost(deps: {
  bb: BbPluginApi;
  now: () => number;
}) {
  // Resolve a host binary: server-wide install at ~/.local/bin first
  // (non-interactive PATH lacks it), PATH fallback otherwise.
  const homeDir = typeof process.env.HOME === "string" ? process.env.HOME : "";
  const localBinDir = homeDir ? nodeJoin(homeDir, ".local", "bin") : "";

  function resolveLocalBin(name: string): string {
    const absolute = localBinDir ? nodeJoin(localBinDir, name) : "";
    return absolute && existsSync(absolute) ? absolute : name;
  }

  const preview = createPreviewRuntime({
    readFile: (path) =>
      deps.bb.sdk.files
        .read({ path })
        .then((file) => file.content)
        .catch(() => null),
    listDirs: (dir) => {
      try {
        return readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);
      } catch {
        return [];
      }
    },
    joinPath: nodeJoin,
    spawnProcess: (command, options) =>
      spawn("bash", ["-lc", command], {
        cwd: options.cwd,
        env: options.env,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    runConnect: (args) => runConnect(resolveLocalBin, args),
    now: deps.now,
    baseEnv: process.env as Record<string, string>,
  });

  registerPreviewDisposal(deps.bb, () => preview.dispose());

  return { preview, resolveLocalBin, homeDir, localBinDir };
}

export type PreviewHost = ReturnType<typeof createPreviewHost>;
