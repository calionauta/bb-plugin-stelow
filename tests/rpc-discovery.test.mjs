import assert from "node:assert/strict";
import { rpcContract } from "../server/rpc-contract.ts";

// Every RPC method publishes a one-line description (BB 0.43
// experimental_discoverRpc): `bb plugin rpc list` and other plugins read
// these without executing code. A method without a description is invisible
// to discovery, so the contract test fails when one is added bare.
//
// The check runs over the COMPOSED contract the composition root registers,
// not over a text scan of the fragments that declare one: importing the real
// object proves every method a caller can discover carries its description,
// including methods contributed by a fragment that never spells
// `defineRpcContract` inline.

const entries = Object.entries(rpcContract);
assert.ok(entries.length > 0, "the composed contract exposes methods");

for (const [name, entry] of entries) {
  assert.equal(typeof entry, "object", `${name} is a contract entry`);
  const description = entry.experimental_description;
  assert.equal(
    typeof description,
    "string",
    `${name} publishes a discovery description`,
  );
  assert.ok(description.length > 0, `${name} has a non-empty description`);
  assert.ok(
    description.length <= 120,
    `${name} description fits discovery UI (${description.length} chars)`,
  );
}

console.log(`rpc discovery test ok: ${entries.length} methods publish descriptions`);
