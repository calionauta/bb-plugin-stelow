import assert from "node:assert/strict";
import test from "node:test";
import { runPublicationMutation } from "../lib/publication-mutation.mjs";

function recordingMutation(execute) {
  const calls = [];
  return {
    calls,
    run: () => runPublicationMutation({
      execute: async () => {
        calls.push("execute");
        return execute();
      },
      close: () => calls.push("close"),
      refreshPublication: async () => calls.push("publication"),
      refreshCard: async () => calls.push("card"),
    }),
  };
}

test("publication mutations close and refresh after success", async () => {
  const mutation = recordingMutation(async () => "saved");

  assert.equal(await mutation.run(), "saved");
  assert.deepEqual(mutation.calls, ["execute", "close", "publication", "card"]);
});

test("publication mutations still close and refresh after partial failure", async () => {
  const failure = new Error("commit failed after the workspace changed");
  const mutation = recordingMutation(async () => { throw failure; });

  await assert.rejects(mutation.run(), failure);
  assert.deepEqual(mutation.calls, ["execute", "close", "publication", "card"]);
});
