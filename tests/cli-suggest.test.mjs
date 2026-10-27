import assert from "node:assert/strict";
import { cliHelpText, cliUsageLine, nearestCommand } from "../lib/cli-suggest.mjs";
import {
  cliHelpResult,
  cliUnknownResult,
  stelowCliCommands,
} from "../server/runtime/cli-registry.ts";
import { createCliDispatch } from "../server/runtime/cli-dispatch.ts";

// The lib helpers are asserted directly.
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

// Wiring: driven rather than grepped. The refusal, the help answer and the
// fallthrough are the behaviour the wiring exists for, and each is asked of the
// real registry and dispatcher — a rename or a stale pasted list cannot satisfy
// them, because the strings are read back out of `stelowCliCommands` now.
const unknown = cliUnknownResult(["satuts"]);
assert.equal(unknown.exitCode, 2, "an unknown command refuses");
assert.match(unknown.stderr, /Did you mean "status"/, "the refusal suggests the nearest declared name");
assert.ok(
  unknown.stderr.includes(cliUsageLine(stelowCliCommands)),
  "fallthrough usage derives from registered metadata",
);
assert.equal(
  cliUnknownResult([]).stderr,
  `Unknown command "".\n${cliUsageLine(stelowCliCommands)}`,
  "an empty invocation refuses without inventing a suggestion",
);

const help = cliHelpResult(["help", "ask"]);
assert.equal(help.exitCode, 0, "help answers without running a command");
assert.equal(help.stdout, cliHelpText(stelowCliCommands, "ask"), "help text renders from registered metadata");
assert.equal(cliHelpResult(["help", "nope"]).exitCode, 2, "help for an unknown command refuses through the same seam");

let runs = 0;
const dispatch = createCliDispatch({
  run: async () => {
    runs += 1;
    return { exitCode: 0, stdout: "ran" };
  },
});
const helped = await dispatch(["help"], {});
assert.equal(helped.exitCode, 0, "the dispatcher answers help itself");
assert.equal(runs, 0, "help never reaches the command runner");
assert.equal((await dispatch([], {})).exitCode, 2, "an empty invocation refuses before the runner");
assert.deepEqual(await dispatch(["status"], {}), { exitCode: 0, stdout: "ran" }, "a declared command falls through to run");
assert.equal(runs, 1, "and reaches the runner exactly once");

console.log("cli suggest test ok: suggestions, derived usage, metadata help, dispatched fallthrough");
