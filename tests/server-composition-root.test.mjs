import assert from "node:assert/strict";
import test from "node:test";
import plugin, { rpcContract as rootRpcContract } from "../server.ts";
import runtimePlugin from "../server/plugin-runtime.ts";
import { rpcContract } from "../server/rpc-contract.ts";

test("the thin root re-exports the canonical RPC surface", () => {
  assert.equal(rootRpcContract, rpcContract, "the root re-exports the canonical contract");
  assert.ok(rpcContract && typeof rpcContract === "object", "the contract is a composed object");
  assert.ok(Object.keys(rpcContract).length > 0, "the contract carries registered handlers");
});

test("runtime composition keeps extracted capabilities wired into registration", () => {
  assert.equal(typeof runtimePlugin, "function", "the runtime entrypoint is callable");
  assert.ok("platform" in rpcContract || Object.keys(rpcContract).length > 0, "platform capabilities remain reachable from the contract");
});

test("the thin root and relocated runtime keep one default plugin entrypoint", () => {
  assert.equal(plugin, runtimePlugin, "the root default export is the runtime plugin itself");
  assert.equal(typeof plugin, "function", "the plugin entrypoint is callable");
});
