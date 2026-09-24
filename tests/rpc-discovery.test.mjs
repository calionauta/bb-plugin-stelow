import assert from "node:assert/strict";
import { composeRpcFragments, RPC_FRAGMENTS, rpcContract } from "../server/rpc-contract.ts";

const composed = composeRpcFragments(RPC_FRAGMENTS);
assert.deepEqual(Object.keys(composed), Object.keys(rpcContract), "the canonical registry is the complete RPC surface");

for (const [name, method] of Object.entries(rpcContract)) {
  const description = method.experimental_description;
  assert.equal(typeof description, "string", `${name} publishes a discovery description`);
  assert.ok(description.length > 0, `${name} discovery description is non-empty`);
  assert.ok(description.length <= 120, `${name} description fits discovery UI (${description.length} chars)`);
}

assert.throws(
  () => composeRpcFragments([{ duplicate: {} }, { duplicate: {} }]),
  /Duplicate RPC contract fragment key: duplicate/,
  "a fragment collision fails instead of silently overwriting an RPC",
);

console.log(`rpc discovery test ok: ${Object.keys(rpcContract).length} methods publish descriptions`);
