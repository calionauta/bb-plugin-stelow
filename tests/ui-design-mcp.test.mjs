import assert from "node:assert/strict";
import {
  AGENT_CLIENTS,
  UI_DESIGN_MCP_SERVERS,
  allowedProviderIds,
  clientAllowedByBb,
  declaredMcpNames,
  jsonMcpNames,
  missingForBb,
  registrationStatus,
  stripJsonComments,
  summarizeServers,
  tomlMcpNames,
} from "../lib/ui-design-mcp.mjs";

// --- comment stripping: a // inside a URL must survive ---
assert.deepEqual(
  jsonMcpNames('{"mcp":{"bifrost":{"url":"http://127.0.0.1:8081/mcp"}}} // trailing'),
  ["bifrost"],
  "line comment removed, URL preserved",
);
assert.deepEqual(
  jsonMcpNames('{/* block */ "mcpServers": {"inspo": {"command":"npx"}} }'),
  ["inspo"],
  "block comment removed",
);
assert.deepEqual(jsonMcpNames('{"a":1,}'), [], "trailing comma tolerated");
assert.deepEqual(jsonMcpNames("not json"), [], "unparseable config yields no names, never throws");
assert.deepEqual(jsonMcpNames("[1,2]"), [], "array root yields no names");
assert.deepEqual(
  jsonMcpNames('{"mcpServers":{"claude-style":{}},"mcp":{"opencode-style":{}}}').sort(),
  ["claude-style", "opencode-style"],
  "mcpServers and mcp both counted",
);
assert.equal(stripJsonComments('"a//b"'), '"a//b"', "a // inside a string is not a comment");

// --- TOML: header lines only, both table spellings ---
assert.deepEqual(
  tomlMcpNames(['model = "gpt-5"', "[mcp_servers.bifrost]", 'url = "http://x"', "[mcp_servers.inspo]"].join("\n")).sort(),
  ["bifrost", "inspo"],
  "mcp_servers tables read",
);
assert.deepEqual(tomlMcpNames("[mcp.inspo]\n"), ["inspo"], "short mcp table read");
assert.deepEqual(tomlMcpNames("[mcp_servers]\n"), [], "bare table is not a server entry");
assert.deepEqual(tomlMcpNames("no tables here"), [], "empty config is empty, not an error");
assert.deepEqual(declaredMcpNames("json", '{"mcp":{"a":{}}}'), ["a"]);
assert.deepEqual(declaredMcpNames("toml", "[mcp_servers.b]\n"), ["b"]);
assert.deepEqual(declaredMcpNames("none", '{"mcp":{"a":{}}}'), [], "no format reads nothing");

// --- the corrected facts, pinned so a bad README cannot reintroduce them ---
const pi = AGENT_CLIENTS.find((c) => c.id === "pi");
assert.ok(pi, "pi is a real client, not a declared-unsupported one");
assert.notEqual(pi.format, "none", "pi reads MCP config through pi-mcp-adapter");
assert.ok(
  pi.configs.includes(".pi/agent/mcp.json"),
  "pi's observed MCP config path is pinned here",
);
const cursor = AGENT_CLIENTS.find((c) => c.id === "cursor");
assert.ok(cursor, "Cursor is a client bb offers; omitting it was a real gap");
assert.ok(cursor.configs.includes(".cursor/mcp.json"), "cursor config path pinned");

// Every client bb can offer must be covered, and every client must declare the
// bb provider ids it answers to. This is the check that caught Cursor.
for (const client of AGENT_CLIENTS) {
  assert.ok(client.providerIds.length > 0, `${client.id} maps to at least one bb provider id`);
  assert.ok(client.configs.length > 0, `${client.id} declares a config path`);
  assert.notEqual(client.format, "none", `${client.id} has a real config format`);
}

// ACP-prefixed provider ids (bb uses acp-opencode / acp-cursor) must map back
const allowed = allowedProviderIds([{ id: "pi" }, { id: "acp-opencode" }, { id: "acp-cursor" }]);
assert.equal(clientAllowedByBb(AGENT_CLIENTS.find((c) => c.id === "opencode"), allowed), true, "acp-opencode maps to opencode");
assert.equal(clientAllowedByBb(cursor, allowed), true, "acp-cursor maps to cursor");
assert.equal(clientAllowedByBb(pi, allowed), true, "pi maps to pi");
assert.equal(
  clientAllowedByBb(AGENT_CLIENTS.find((c) => c.id === "claude-code"), allowed),
  false,
  "a client bb does not offer here is not allowed",
);
assert.equal(allowedProviderIds(null).size, 0, "an absent provider list is empty, not a throw");
assert.equal(allowedProviderIds([null, { id: 5 }]).size, 0, "malformed entries are skipped");

// --- registration matrix ---
const inspo = UI_DESIGN_MCP_SERVERS.find((s) => s.id === "inspo");
const claude = AGENT_CLIENTS.find((c) => c.id === "claude-code");
// "bb offers every client in the registry" — shaped like bb's provider objects
const all = allowedProviderIds(
  AGENT_CLIENTS.flatMap((c) => c.providerIds.map((id) => ({ id }))),
);

assert.equal(
  registrationStatus(inspo, claude, { installed: true, names: ["inspo"], source: ".claude.json" }, all).state,
  "registered",
  "exact alias counts as registered",
);
assert.equal(
  registrationStatus(inspo, claude, { installed: true, names: ["inspo-mcp"], source: ".claude.json" }, all).state,
  "registered",
  "alternate alias counts as registered",
);
assert.equal(
  registrationStatus(inspo, claude, { installed: true, names: ["bifrost"], source: ".claude.json" }, all).state,
  "unregistered",
  "an installed CLI with other servers is unregistered, not ready",
);
assert.equal(
  registrationStatus(inspo, claude, { installed: false, names: ["inspo"], source: ".claude.json" }, all).state,
  "not-installed",
  "a stale config entry for a CLI off PATH is not coverage",
);
assert.equal(
  registrationStatus(inspo, claude, { installed: true, names: [], source: null }, allowedProviderIds(["pi"])).state,
  "not-allowed",
  "an installed CLI bb does not offer is not a gap to report",
);
assert.equal(
  registrationStatus(inspo, claude, { installed: true, names: ["inspo"], source: ".claude.json" }, null).state,
  "registered",
  "an absent provider list never downgrades a real registration",
);

// --- the fix list names exactly the CLIs bb can run that lack the server ---
const rows = [
  { name: "Claude Code", state: "unregistered" },
  { name: "Codex", state: "registered" },
  { name: "Cursor", state: "unregistered" },
  { name: "Pi", state: "not-allowed" },
  { name: "Vim", state: "not-installed" },
];
assert.deepEqual(
  missingForBb(inspo, rows),
  ["Claude Code", "Cursor"],
  "only unregistered rows are named — not installed, not-allowed, or registered ones",
);
assert.deepEqual(missingForBb(inspo, []), [], "no rows means nothing to fix");

// --- rollup precedence ---
const ready = summarizeServers(
  {
    "claude-code": { installed: true, names: ["inspo"], source: ".claude.json" },
    codex: { installed: false, names: [], source: null },
    opencode: { installed: true, names: [], source: ".config/opencode/opencode.json" },
    pi: { installed: true, names: [], source: ".pi/agent/mcp.json" },
    cursor: { installed: false, names: [], source: null },
  },
  all,
);
const readyInspo = ready.find((s) => s.id === "inspo");
assert.equal(readyInspo.state, "ready");
assert.equal(readyInspo.usable, 1, "only Claude Code is registered");
assert.equal(readyInspo.pending, 2, "OpenCode and Pi are installed and bb-runnable but unregistered");
assert.deepEqual(
  readyInspo.missing,
  ["OpenCode", "Pi"],
  "the fix list names every pending CLI, in registry order",
);

const notAllowed = summarizeServers(
  {
    "claude-code": { installed: true, names: [], source: ".claude.json" },
    pi: { installed: true, names: [], source: ".pi/agent/mcp.json" },
  },
  allowedProviderIds(["pi"]),
);
assert.equal(notAllowed.find((s) => s.id === "inspo").pending, 0, "pi alone does not create a gap when bb cannot run it for MCP");
assert.equal(notAllowed.find((s) => s.id === "inspo").state, "absent");

const empty = summarizeServers(undefined);
assert.equal(empty.find((s) => s.id === "inspo").state, "absent");
assert.ok(empty.every((s) => s.usable === 0), "no read data never reports usable");
assert.ok(empty.every((s) => Array.isArray(s.missing)), "every server carries a fix list, even empty");

// --- registry self-consistency ---
for (const server of UI_DESIGN_MCP_SERVERS) {
  assert.ok(server.register.length > 0, `${server.id} has a register command`);
  assert.ok(server.feeds.length > 0, `${server.id} names the step it feeds`);
  assert.ok(server.aliases.length > 0, `${server.id} has at least one alias`);
  assert.ok(server.package.length > 0, `${server.id} names its npm package`);
}
// Every registered server must ship an installer. A vendor without one cannot
// be one-click, and offering a button that cannot register anything is worse
// than no button — so adding such a vendor means adding a real installer path
// first, not a flag.
assert.equal(
  UI_DESIGN_MCP_SERVERS.length,
  1,
  "one design-reference server: Inspo is an archive and cannot capture a live URL, " +
    "so the live-capture alternative was dropped rather than shipped with a dead button",
);
for (const server of UI_DESIGN_MCP_SERVERS) {
  assert.match(server.register, /install/, `${server.id} registers through a vendor installer command`);
}
// Alphabetical by name, so the About panel order is stable without a sort at render
const names = UI_DESIGN_MCP_SERVERS.map((s) => s.name);
assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), "server registry is alphabetical");

console.log("ui-design-mcp.test.mjs OK");
