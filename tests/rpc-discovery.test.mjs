import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Every RPC method publishes a one-line description (BB 0.43
// experimental_discoverRpc): `bb plugin rpc list` and other plugins read
// these without executing code. A method without a description is invisible
// to discovery, so the contract test fails when one is added bare.
//
// The contract is split across server.ts (main contract) and server/*.ts
// feature slices (github-issues.ts precedent: contract fragment + handlers
// + migrations + scheduler). Internal feature modules may live beside those
// contracts, so discovery scans every server module that declares one.
const contractFiles = readdirSync(join(root, "server"))
  .filter((file) => file.endsWith(".ts"))
  .map((file) => join("server", file))
  .filter((file) => readFileSync(join(root, file), "utf8").includes("defineRpcContract({"));
const contracts = [
  { file: "server.ts", start: "export const rpcContract = defineRpcContract({", end: "export type PreviewInfo" },
  ...contractFiles.map((file) => ({ file, start: "defineRpcContract({", end: null })),
];

let total = 0;
for (const { file, start, end } of contracts) {
  const content = readFileSync(join(root, file), "utf8");
  const from = content.indexOf(start);
  assert.ok(from >= 0, `${file} holds its RPC contract`);
  const scope = end ? content.slice(from, content.indexOf(end, from)) : content.slice(from);
  const names = [...scope.matchAll(/^  ([A-Za-z]+): \{$/gm)].map((match) => match[1]);
  assert.ok(names.length > 0, `${file} exposes contract methods`);
  for (const name of names) {
    total += 1;
    const at = scope.indexOf(`  ${name}: {`);
    const block = scope.slice(at, scope.indexOf("\n  },", at));
    const described = block.match(/^\s+experimental_description: "([^"]+)",$/m);
    assert.ok(described, `${file}#${name} publishes a discovery description`);
    assert.ok(described[1].length <= 120, `${file}#${name} description fits discovery UI (${described[1].length} chars)`);
  }
}


// The contract opts into host-side discovery: descriptions alone leave
// bb plugin rpc list empty, so this fails if the opt-in flag is dropped.
const srv = readFileSync(join(root, "server.ts"), "utf8");
assert.match(srv, /experimental_discoverable: true/, "register opts into discovery");
console.log(`rpc discovery test ok: ${total} methods publish descriptions`);
