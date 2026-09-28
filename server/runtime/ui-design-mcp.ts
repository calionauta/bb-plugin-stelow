/**
 * Host side of the UI design reference MCPs: probe each agent CLI, read its
 * config, compare against bb's provider registry, and register on request.
 *
 * Why this reads config files instead of asking each CLI: `claude mcp list`,
 * `codex mcp list`, and friends are separate flags on separate CLIs with
 * separate output formats and no stability promise. A vendor installer writes
 * those same config files, so reading them is both the cheapest probe and the
 * one that cannot disagree with what an install actually did.
 *
 * Why the provider registry matters: the useful question is not "is this CLI
 * installed" but "can a Stelow worker actually run under it, and would it see
 * the server". An installed CLI bb does not offer is noise; a CLI bb DOES
 * offer that lacks the registration is the silent hole worth reporting.
 *
 * What the status does NOT claim: that the server is reachable. A config entry
 * proves registration, not a working handshake. The UI says "registered" for
 * exactly that reason and leaves health to the worker's own tool call.
 */
import { execFile } from "node:child_process";
import { accessSync, constants, readFileSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import {
  AGENT_CLIENTS,
  UI_DESIGN_MCP_SERVERS,
  allowedProviderIds,
  declaredMcpNames,
  summarizeServers,
} from "../../lib/ui-design-mcp.mjs";

type Provider = { id: string };

export type ClientReads = {
  installed: boolean;
  names: string[];
  source: string | null;
  /** The spec the config pins, e.g. "npx -y inspo-mcp@0.1.16" — null when unpinned. */
  pinned: string | null;
};

export type UiDesignMcpStatus = {
  servers: ReturnType<typeof summarizeServers>;
  /** bb provider ids this host offers, so the panel can name the real gap. */
  bbProviders: string[];
  /** CLIs bb can run that no registry entry covers — a Stelow-side blind spot. */
  unmappedProviders: string[];
  unsupported: Array<{ client: string; name: string; note: string }>;
};

export type UiDesignMcpDeps = {
  homeDir: string;
  bb: { sdk: { providers: { list: () => Promise<Provider[]> } } };
  listProviders?: () => Promise<Provider[]>;
  runRegister?: (serverId: string) => Promise<{ code: number; out: string }>;
  /**
   * The environment `installed` is answered from.
   *
   * Injected rather than read from the ambient process so a test can say which
   * CLIs exist. Left unset, it stays `process.env` — the same answer, but the
   * handlers below pass it explicitly instead of each call site deciding.
   */
  env?: NodeJS.ProcessEnv;
};

const MAX_CONFIG_BYTES = 1024 * 1024;

/** PATH scan instead of a spawn: a `--version` probe would cost a process per
 *  CLI per About-panel open, for a question the filesystem already answers. */
export function binaryOnPath(bin: string, env: NodeJS.ProcessEnv = process.env): boolean {
  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    try {
      accessSync(join(dir, bin), constants.X_OK);
      return true;
    } catch { /* keep scanning */ }
  }
  return false;
}

/**
 * The version spec a config pins, if any. `npx -y inspo-mcp@0.1.16` yields
 * "0.1.16"; an unpinned entry yields null.
 */
export function pinnedVersion(text: string, aliases: string[]): string | null {
  for (const alias of aliases) {
    // The package name may be a longer form of the alias ("inspo" vs
    // "inspo-mcp"), so allow an optional suffix before the version pin.
    const match = text.match(
      new RegExp(`${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:-[a-z0-9-]+)?@(\\d+\\.\\d+\\.\\d+)`),
    );
    if (match) return match[1];
  }
  return null;
}

/** First readable config that parses, and the server names it declares. */
function readClientConfig(
  client: (typeof AGENT_CLIENTS)[number],
  homeDir: string,
): { source: string | null; names: string[]; text: string } {
  for (const relative of client.configs) {
    const path = isAbsolute(relative) ? relative : join(homeDir, relative);
    let text: string;
    try {
      text = readFileSync(path, "utf8").slice(0, MAX_CONFIG_BYTES);
    } catch { continue; }
    // A readable but empty config is still the authoritative "not here".
    return { source: relative, names: declaredMcpNames(client.format, text), text };
  }
  return { source: null, names: [], text: "" };
}

export async function readUiDesignMcpStatus(
  deps: UiDesignMcpDeps,
  env: NodeJS.ProcessEnv = process.env,
): Promise<UiDesignMcpStatus> {
  const listProviders = deps.listProviders ?? (() => deps.bb.sdk.providers.list());
  const providers = await listProviders().catch(() => [] as Provider[]);
  const allowed = allowedProviderIds(providers);
  const reads: Record<string, ClientReads> = {};
  const unsupported: UiDesignMcpStatus["unsupported"] = [];
  for (const client of AGENT_CLIENTS) {
    const config = readClientConfig(client, deps.homeDir);
    reads[client.id] = {
      installed: binaryOnPath(client.bin, env),
      names: config.names,
      source: config.source,
      pinned: pinnedVersion(config.text, config.names.flatMap((name) =>
        (UI_DESIGN_MCP_SERVERS.find((s) => s.aliases.includes(name))?.aliases ?? [name]))),
    };
    if (client.note) unsupported.push({ client: client.id, name: client.name, note: client.note });
  }
  const mapped = new Set(AGENT_CLIENTS.flatMap((client) => client.providerIds ?? []));
  return {
    servers: summarizeServers(reads, allowed),
    bbProviders: providers.map((provider) => provider.id),
    unmappedProviders: providers.map((provider) => provider.id).filter((id) => !mapped.has(id)),
    unsupported,
  };
}

/**
 * Registration runs the vendor's own installer, in the real HOME.
 *
 * HOME isolation is deliberately NOT used here, unlike the host-tool
 * installer: the installers write to the user's agent-CLI configs, and an
 * isolated HOME would write to a temp dir and report success while changing
 * nothing. Registering is a host-level act the person asked for by clicking.
 */
export function runUiDesignMcpRegister(
  deps: UiDesignMcpDeps,
  serverId: string,
): Promise<{ code: number; out: string }> {
  return (deps.runRegister ?? (() => defaultRegister()))(serverId);
}

function defaultRegister(): Promise<{ code: number; out: string }> {
  // The one registered server ships a real installer: it detects the agent
  // CLIs on the machine, shows a plan, and asks before writing anything.
  const args = ["-y", "inspo-mcp", "install"];
  return new Promise((resolve) => {
    execFile("npx", args, { timeout: 300_000, maxBuffer: MAX_CONFIG_BYTES },
      (error, stdout, stderr) => {
        const out = `${typeof stdout === "string" ? stdout : ""}\n${typeof stderr === "string" ? stderr : ""}`.trim();
        resolve({ code: error ? 1 : 0, out: out.slice(-4000) });
      });
  });
}

export function createUiDesignMcpHandlers(deps: UiDesignMcpDeps) {
  const env = deps.env ?? process.env;
  const status = () => readUiDesignMcpStatus(deps, env);
  return {
    uiDesignMcpStatus: status,
    registerUiDesignMcp: async ({ serverId }: { serverId: string }) => {
      const server = UI_DESIGN_MCP_SERVERS.find((entry) => entry.id === serverId);
      if (!server)
        return { ok: false, error: `Unknown design reference MCP: ${serverId}`, status: await status() };
      const result = await runUiDesignMcpRegister(deps, serverId);
      const current = await status();
      const row = current.servers.find((entry) => entry.id === serverId);
      const registered = row?.usable ?? 0;
      return {
        ok: registered > 0,
        error:
          result.code === 0 && registered > 0
            ? null
            : result.out || "Registration did not take effect. Re-check after restarting the agent CLI.",
        status: current,
      };
    },
  };
}
