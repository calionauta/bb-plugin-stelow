import assert from "node:assert/strict";
import test from "node:test";
import { cliHelpResult, cliUnknownResult, stelowCliCommands } from "../server/runtime/cli-registry.ts";

test("CLI registry keeps unique command names and help wired to the same catalog", () => {
  const names = stelowCliCommands.map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length, "duplicate CLI names make help ambiguous");
  assert.ok(names.includes("status"));
  assert.ok(names.includes("export"));
  assert.ok(names.includes("help"));

  const result = cliHelpResult(["help", "export"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /bb stelow export/);
});

test("unknown CLI commands and help share suggestion and usage behavior", () => {
  const help = cliHelpResult(["help", "exper"]);
  const command = cliUnknownResult(["exper"]);

  assert.equal(help.exitCode, 2);
  assert.deepEqual(help, command, "help and dispatch cannot drift into different refusal behavior");
  assert.match(command.stderr, /Unknown command "exper"/);
  assert.match(command.stderr, /Did you mean "export"\?/);
  assert.match(command.stderr, /\|help$/);
});
