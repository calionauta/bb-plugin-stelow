import assert from "node:assert/strict";
import test from "node:test";
import { platformRpcContract } from "../server/platform-rpc-contract.ts";
import { readDiagramRendererStatus } from "../server/runtime/diagram-renderer.ts";

/**
 * The platform surface for the bundled renderer: the About panel reads this
 * RPC, so a status missing a field the panel renders is refused where it is
 * produced. The input takes nothing (NO_INPUT-equivalent: null, undefined
 * and {} all read as the empty object, anything else is refused); the output
 * is exactly {present, version, detail}, and both real status answers parse.
 *
 * Import style follows tests/capability-affordances.test.mjs: the contract
 * from `server/platform-rpc-contract.ts`, the producer from its runtime
 * module, asserted against each other rather than against prose.
 */

const PINNED = "1.8.0";
const INSTALL = "npm install pele@1.8.0";

test("the renderer status is a contracted no-input RPC", () => {
  const entry = platformRpcContract.diagramRendererStatus;
  assert.ok(entry, "the platform contract exposes diagramRendererStatus");
  assert.equal(typeof entry.experimental_description, "string", "the status is a described RPC");
  assert.deepEqual(entry.input.parse(null), {}, "a caller with nothing to say sends null");
  assert.deepEqual(entry.input.parse(undefined), {}, "and omitting the argument reads the same");
  assert.deepEqual(entry.input.parse({}), {}, "as does the empty object");
  assert.throws(
    () => entry.input.parse({ unexpected: true }),
    "a status read takes no fields",
  );
});

test("the contracted output is exactly {present, version, detail}", () => {
  const entry = platformRpcContract.diagramRendererStatus;
  const present = readDiagramRendererStatus({}, PINNED, INSTALL);
  assert.deepEqual(entry.output.parse(present), present, "the bundled answer is the contracted shape");
  const absent = readDiagramRendererStatus(null, PINNED, INSTALL);
  assert.deepEqual(entry.output.parse(absent), absent, "and so is the absent answer");
  assert.throws(
    () => entry.output.parse({ present: true, version: PINNED }),
    "a status without its detail is refused where it is produced",
  );
});

console.log("diagram renderer contract ok: no-input status in, {present, version, detail} out");
