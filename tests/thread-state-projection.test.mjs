import assert from "node:assert/strict";
import test from "node:test";
import { projectThreadError } from "../server/runtime/thread-state-projection.ts";

/**
 * A worker thread the host says does not exist is healed, not re-reported.
 *
 * Two cards were sitting on `HTTP 404: Thread not found` with the dead id still
 * recorded: every poll rewrote the same raw host string, every Retry re-read the
 * same missing thread, and one of them still advertised "The agent is waiting
 * for your answer to continue" over a thread that had been deleted. The string
 * appeared nowhere in `server/**` or `lib/**`, so nothing could tell "the thread
 * is gone" apart from "the host hiccuped".
 *
 * Asserted by behavior: the projection's own output for each message shape.
 */

test("a gone thread clears the worker id and says what to do", () => {
  for (const message of [
    "HTTP 404: Thread not found",
    "thread_not_found",
    "Thread Not Found",
  ]) {
    const update = projectThreadError(new Error(message));
    assert.equal(update.activity, "error");
    assert.equal(
      update.worker_thread_id,
      null,
      `"${message}" clears the dead id so Restart can spawn one`,
    );
    assert.match(
      String(update.last_error),
      /Start a new worker/,
      "and the message names the action instead of quoting a transport error",
    );
    assert.doesNotMatch(String(update.last_error), /404|thread_not_found/);
  }
});

test("an ordinary read failure keeps the raw message and the worker id", () => {
  const update = projectThreadError(new Error("Timed out waiting for command result"));
  assert.equal(update.activity, "error");
  assert.equal(
    Object.hasOwn(update, "worker_thread_id"),
    false,
    "a transport fault must not orphan a worker that is still there",
  );
  assert.equal(update.last_error, "Timed out waiting for command result");
});

test("a non-Error rejection still produces a usable message", () => {
  const update = projectThreadError("not an error object");
  assert.equal(update.last_error, "Unable to read worker thread.");
  assert.equal(update.activity, "error");
});

console.log(
  "thread state projection ok: a deleted thread clears its id and names the action, "
  + "while a transport fault leaves the worker alone",
);
