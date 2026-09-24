import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cliHelpText, cliUsageLine, nearestCommand } from "../lib/cli-suggest.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = [
  readFileSync(join(root, "server/plugin-runtime.ts"), "utf8"),
  readFileSync(join(root, "server/runtime/cli-registry.ts"), "utf8"),
].join("\n");

// Suggestions: transpositions and missing letters resolve, far strings do not.
assert.equal(nearestCommand("advnace", ["advance", "ask", "status"]), "advance");
assert.equal(nearestCommand("satuts", ["advance", "ask", "status"]), "status");
assert.equal(nearestCommand("ASK", ["advance", "ask", "status"]), "ask");
assert.equal(nearestCommand("  done  ", ["done", "doctor"]), "done");
assert.equal(nearestCommand("xyzzy", ["advance", "ask", "status"]), null);
assert.equal(nearestCommand("", ["advance"]), null);
assert.equal(nearestCommand(null, ["advance"]), null);
assert.equal(nearestCommand("ask", []), null);
assert.equal(nearestCommand("ask", null), null);
// Ties resolve to registration order, so the suggestion never flip-flops.
assert.equal(nearestCommand("do", ["done", "door", "doctor"]), "done");

// Help and usage derive from the declared metadata, never pasted prose.
const commands = [
  { name: "ask", summary: "Ask questions", usage: "bb stelow ask ..." },
  { name: "done", summary: "Finish", usage: "bb stelow done" },
];
assert.equal(cliUsageLine(commands), "Usage: bb stelow ask|done");
assert.equal(cliUsageLine([]), "Usage: bb stelow ");
assert.equal(cliHelpText(commands, "ask"), "ask: Ask questions\nbb stelow ask ...");
assert.equal(cliHelpText(commands, "nope"), null);
assert.equal(cliHelpText(commands), "ask: Ask questions\ndone: Finish");

// Wiring: the dispatcher suggests, helps, and never pastes a stale list.
assert.match(server, /nearestCommand\(requested/, "unknown CLI commands suggest the nearest declared name");
assert.match(server, /Did you mean/, "the suggestion reads as a question, not a bare error");
assert.match(server, /cliUsageLine\(stelowCliCommands\)/, "fallthrough usage derives from registered metadata");
assert.match(server, /if \(argv\[0\] === "help"\) return cliHelpResult\(argv\)/, "help answers without running a command");
assert.match(server, /return cliUnknownResult\(argv\)/, "dispatch falls through to the same refusal seam");
assert.match(server, /cliHelpText\(stelowCliCommands/, "help text renders from registered metadata");
assert.match(server, /commands: stelowCliCommands/, "one command table feeds registration, usage, and help");
assert.doesNotMatch(server, /Usage: bb stelow status\|ask\|seed\|advance\|done\|playbook\|split\|doctor\|sync-scopes\|lock\|config\|schema\|fan-out\|verify\|review\|preset\|manifest\|export\|draft/, "the stale pasted usage list is gone");

console.log("cli suggest test ok: suggestions, derived usage, metadata help");
