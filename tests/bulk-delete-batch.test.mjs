import assert from "node:assert/strict";
import { BULK_DELETE_BATCH_SIZE, deleteInBatches } from "../lib/bulk-delete-batch.mjs";

/**
 * The RPC's 200-id cap is a request-size guard, not a product limit. Sending
 * 201 produced `HTTP 400: rpc input validation failed` under a dialog that had
 * just promised "Deletes all 201 archived cards" — nothing deleted, nothing
 * explained, and no way to tell a refusal from a failure.
 *
 * So the client batches. What is pinned here is that batching does not become
 * its own kind of dishonesty: a chunk that fails at the transport level must
 * still be accounted for, because a run that silently dropped a third of the
 * column leaves the reader looking at cards that are still there and believing
 * the column is empty.
 */

const SIZE = BULK_DELETE_BATCH_SIZE;
const ids = (n) => Array.from({ length: n }, (_, i) => `card_${i}`);

// Under the cap: one call, and the shape comes straight back.
{
  const calls = [];
  const out = await deleteInBatches(async (batch) => {
    calls.push(batch.length);
    return { deleted: batch, failed: [] };
  }, ids(5));
  assert.deepEqual(calls, [5], "a small column is a single call, not padded into batches");
  assert.equal(out.deleted.length, 5);
  assert.deepEqual(out.failed, []);
}

// Exactly the cap: still one call. Off-by-one here would send a pointless
// second request for a column that fits.
{
  const calls = [];
  await deleteInBatches(async (batch) => {
    calls.push(batch.length);
    return { deleted: batch, failed: [] };
  }, ids(SIZE));
  assert.deepEqual(calls, [SIZE], "the cap itself fits in one call");
}

// Over the cap: the exact case that used to 400.
{
  const calls = [];
  const out = await deleteInBatches(async (batch) => {
    calls.push(batch.length);
    return { deleted: batch, failed: [] };
  }, ids(201));
  assert.deepEqual(calls, [200, 1], "201 splits at the cap, and the remainder is not padded");
  assert.equal(out.deleted.length, 201, "every card is still accounted for");
  assert.deepEqual(out.failed, []);
}

// Order is preserved across batches, because the reader saw them in that order.
{
  const out = await deleteInBatches(async (batch) => ({ deleted: batch, failed: [] }), ids(450));
  assert.equal(out.deleted[0], "card_0", "the first card the reader saw is first");
  assert.equal(out.deleted.at(-1), "card_449", "and so is the last");
  assert.equal(out.deleted.length, 450, "no card is lost or duplicated at a boundary");
}

// A refused card in a LATER batch is still reported, with its own reason.
{
  const out = await deleteInBatches(async (batch) => (
    batch.includes("card_250")
      ? { deleted: batch.filter((id) => id !== "card_250"), failed: [{ cardId: "card_250", error: "not archived" }] }
      : { deleted: batch, failed: [] }
  ), ids(450));
  assert.equal(out.deleted.length, 449);
  assert.deepEqual(out.failed, [{ cardId: "card_250", error: "not archived" }], "its reason survives the batching");
}

// The transport failing on one batch must not be swallowed, and must not stop
// the batches after it — the reader gets the full picture either way.
{
  const seen = [];
  const out = await deleteInBatches(async (batch) => {
    seen.push(batch.length);
    if (batch.includes("card_0")) throw new Error("rpc exploded");
    return { deleted: batch, failed: [] };
  }, ids(450));
  assert.deepEqual(seen, [200, 200, 50], "a failed batch does not abort the rest — the reader learns about all of them");
  assert.equal(out.deleted.length, 250, "the two healthy batches went");
  assert.equal(out.failed.length, 1, "and the dead one is named, not dropped");
  assert.match(out.failed[0].error, /Batch of 200 not deleted: rpc exploded/, "naming the size and the reason");
}

// A malformed result from a batch is treated as unaccounted, not as success.
{
  const out = await deleteInBatches(async () => null, ids(2));
  assert.deepEqual(out.deleted, [], "a null result is not a deletion");
  assert.deepEqual(out.failed, [], "and not a refusal either — there is nothing to report per card");
}

// Nothing to do is not an error and makes no call.
{
  let called = 0;
  const out = await deleteInBatches(async () => { called += 1; return { deleted: [], failed: [] }; }, []);
  assert.equal(called, 0, "an empty column makes no request");
  assert.deepEqual(out, { deleted: [], failed: [] });
}

console.log("bulk delete batching test ok: the cap is a transport limit, and every card is still accounted for");
