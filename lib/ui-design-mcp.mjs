/**
 * UI design reference MCPs: which agent CLIs on this host can reach one, and
 * whether each one is already registered.
 *
 * Three questions, deliberately kept apart:
 *   - "is the CLI installed"        — a PATH question, answered by the host;
 *   - "does bb allow this CLI"      — a provider-registry question;
 *   - "is the MCP registered there" — a config-file question, answered here.
 *
 * The middle one is what makes the panel honest. A tool the user will never
 * run under bb is not a gap worth reporting, and a CLI bb DOES allow but that
 * lacks the registration is exactly the silent hole this exists to surface.
 *
 * The split matters because registration is per-CLI and never global. A vendor
 * installer writes the clients that existed when it ran, so a CLI installed
 * afterwards is installed-but-unregistered. Reporting that honestly (instead
 * of a single "done") is what makes it repairable.
 *
 * Pure: no fs, no child_process, no bb SDK. The host supplies file reads and
 * the provider list; this module only parses them and decides the verdict.
 */

/**
 * Known design-reference MCPs, and the workflow step each one feeds.
 *
 * One entry, and it is an archive rather than a live-page inspector: every tool
 * answers "what does a real page for this macrostructure look like", and none
 * can capture or analyse a URL you hand it. That is exactly the job Interface
 * Alternatives has and exactly the gap UX Critique does NOT need filling — that
 * one is served first by the harness-native browser.
 *
 * A second live-capture server was evaluated and dropped: it shipped no
 * installer (so a Register button there could not have worked), scraped a
 * third-party site, and its only unique capability duplicated a browser the
 * workflow already reaches for. Its `registerKind` split is gone with it — with
 * one installable server, a flag distinguishing installable from not is
 * machinery for a second case that does not exist.
 */
export const UI_DESIGN_MCP_SERVERS = [
  {
    id: "inspo",
    name: "Inspo",
    repo: "https://github.com/Nutlope/inspo",
    /** The npm spec `npx` resolves. */
    package: "inspo-mcp",
    /** Config-name spellings that count as this server being registered. */
    aliases: ["inspo", "inspo-mcp"],
    /** The vendor command registers every agent CLI it finds, so one click works. */
    register: "npx -y inspo-mcp install",
    plain: "Real shipped sites the agent can study for layout, palette, and type before it writes UI.",
    feeds: "Interface Alternatives — named macrostructures and copy-pasteable reference JSX.",
    note: "Installs itself into every agent CLI it finds. Vector search needs a Together AI key; lexical search works without one.",
  },
];

/**
 * Agent CLIs a Stelow worker can run under, and where each keeps its MCP
 * config. `configs` are home-relative and read in order — the first readable
 * file decides. `providerIds` maps this client onto bb's provider registry, so
 * the panel can say "bb allows this CLI" instead of guessing from the name.
 *
 * Every entry is a CLI that has actually been observed carrying MCP config on
 * a bb host. A CLI with no known config location is deliberately absent rather
 * than guessed at: reporting a path we have not seen would be a fabrication
 * dressed as a probe.
 */
export const AGENT_CLIENTS = [
  {
    id: "claude-code",
    name: "Claude Code",
    bin: "claude",
    format: "json",
    configs: [".claude.json", ".claude/settings.json"],
    providerIds: ["claude-code"],
  },
  {
    id: "codex",
    name: "Codex",
    bin: "codex",
    format: "toml",
    configs: [".codex/config.toml"],
    providerIds: ["codex"],
  },
  {
    id: "opencode",
    name: "OpenCode",
    bin: "opencode",
    format: "json",
    configs: [".config/opencode/opencode.json", ".config/opencode/opencode.jsonc"],
    providerIds: ["acp-opencode", "opencode"],
  },
  {
    id: "pi",
    name: "Pi",
    bin: "pi",
    format: "json",
    configs: [".pi/agent/mcp.json"],
    providerIds: ["pi"],
    // Verified on this host: pi reads MCP servers through the pi-mcp-adapter
    // extension, from .pi/agent/mcp.json. Earlier notes claiming pi has "no MCP
    // support by design" came from a third-party README and were wrong.
    note: "MCP support comes from the pi-mcp-adapter extension; without it, config entries are inert.",
  },
  {
    id: "cursor",
    name: "Cursor",
    bin: "cursor",
    format: "json",
    configs: [".cursor/mcp.json"],
    providerIds: ["acp-cursor", "cursor"],
  },
];

export function isUiDesignMcpId(value) {
  return UI_DESIGN_MCP_SERVERS.some((server) => server.id === value);
}

export function clientById(id) {
  return AGENT_CLIENTS.find((client) => client.id === id) ?? null;
}

/**
 * Drop `//` and `/* *\/` comments and trailing commas so a `.jsonc` config
 * parses. String contents are preserved — a `//` inside a URL must survive.
 */
export function stripJsonComments(text) {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inLine) {
      if (char === "\n") { inLine = false; out += char; }
      continue;
    }
    if (inBlock) {
      if (char === "*" && next === "/") { inBlock = false; index += 1; }
      continue;
    }
    if (inString) {
      out += char;
      if (char === "\\") { out += next ?? ""; index += 1; }
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; out += char; continue; }
    if (char === "/" && next === "/") { inLine = true; index += 1; continue; }
    if (char === "/" && next === "*") { inBlock = true; index += 1; continue; }
    out += char;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/** Server names declared in a JSON config, across both common shapes. */
export function jsonMcpNames(text) {
  let parsed;
  try {
    parsed = JSON.parse(stripJsonComments(text));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const names = new Set();
  for (const key of ["mcpServers", "mcp"]) {
    const block = parsed[key];
    if (block && typeof block === "object" && !Array.isArray(block)) {
      for (const name of Object.keys(block)) names.add(name);
    }
  }
  return [...names];
}

/**
 * Server names declared in a TOML config. Header lines only — the value
 * blocks are not parsed, because "is this server registered" is answered by
 * the table header, and a hand-rolled TOML reader would be a liability.
 */
export function tomlMcpNames(text) {
  const names = new Set();
  const pattern = /^\s*\[(?:mcp_servers|mcp)\.([^\]\s]+)\]/gm;
  for (const match of text.matchAll(pattern)) names.add(match[1]);
  return [...names];
}

/** Every server name a config text declares, by that client's format. */
export function declaredMcpNames(format, text) {
  if (format === "toml") return tomlMcpNames(text);
  if (format === "json") return jsonMcpNames(text);
  return [];
}

/** The bb provider ids this host allows, as a set the client rows can match. */
export function allowedProviderIds(providers) {
  const ids = new Set();
  for (const provider of Array.isArray(providers) ? providers : []) {
    if (provider && typeof provider === "object" && typeof provider.id === "string") {
      ids.add(provider.id);
    }
  }
  return ids;
}

/** True when bb's provider registry allows at least one id for this client. */
export function clientAllowedByBb(client, allowed) {
  return (client.providerIds ?? []).some((id) => allowed.has(id));
}

/**
 * The verdict for one (server, client) pair.
 *
 * `installed: false` outranks everything: an unregistered entry in a config
 * for a CLI that is no longer on PATH is not coverage. An installed CLI that
 * bb does not allow is not a gap either — nothing will ever run under it.
 */
export function registrationStatus(server, client, reads, allowed) {
  const allowedHere = allowed ? clientAllowedByBb(client, allowed) : true;
  if (!reads?.installed)
    return { state: "not-installed", detail: `${client.name} is not on PATH on this host.` };
  if (!allowedHere)
    return {
      state: "not-allowed",
      detail: `${client.name} is installed, but bb does not offer it as an agent provider here.`,
    };
  const names = new Set(reads.names ?? []);
  if (server.aliases.some((alias) => names.has(alias)))
    return { state: "registered", detail: `Registered in ${reads.source ?? "this CLI's config"}.` };
  return {
    state: "unregistered",
    detail: reads.source
      ? `${client.name} is installed and bb can run it, but ${reads.source} does not name this server.`
      : `${client.name} is installed and bb can run it, but no readable config names this server.`,
  };
}

/** The rows that matter most: bb can run these, and they lack the server. */
export function missingForBb(server, clients) {
  return clients.filter((row) => row.state === "unregistered").map((row) => row.name);
}

/** Per-server rollup: which installed CLIs still need a registration. */
export function summarizeServers(reads, allowed) {
  return UI_DESIGN_MCP_SERVERS.map((server) => {
    const clients = AGENT_CLIENTS.map((client) => ({
      client: client.id,
      name: client.name,
      ...registrationStatus(server, client, reads?.[client.id], allowed),
    }));
    const usable = clients.filter((row) => row.state === "registered");
    const pending = clients.filter((row) => row.state === "unregistered");
    return {
      id: server.id,
      name: server.name,
      repo: server.repo,
      package: server.package,
      register: server.register,
      plain: server.plain,
      feeds: server.feeds,
      note: server.note ?? "",
      clients,
      usable: usable.length,
      pending: pending.length,
      /** The CLIs bb can run that would not see this server — the fix list. */
      missing: missingForBb(server, clients),
      state:
        usable.length > 0
          ? "ready"
          : pending.length > 0
            ? "available"
            : "absent",
    };
  });
}
