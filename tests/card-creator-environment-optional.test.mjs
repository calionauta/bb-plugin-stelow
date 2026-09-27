import assert from "node:assert/strict";
import { cardRpcContract } from "../server/card-rpc-contract.ts";
import { lifecycleRpcContract } from "../server/lifecycle-rpc-contract.ts";
import { selectCardEnvironment } from "../lib/card-environment.mjs";

/**
 * A published contract must admit the call its handler supports.
 *
 * All three card creators run through `createCardInternal`, which resolves the
 * worker environment with `selectCardEnvironment(input.environment, <the
 * workspace's own environment>)` — a request that is absent or unrecognised
 * falls back rather than failing. So every creator genuinely answers "the
 * project default" when `environment` is omitted.
 *
 * The contract said `environment: z.unknown()`. That reads as "any value",
 * which is not the same claim as "may be absent" — and a non-optional property
 * is exactly what the host's schema derivation reports as REQUIRED. The host's
 * own plugin probe omits it, so all three were refused at validation for a call
 * the handler supports, and the refusal surfaced on the plugin's status line:
 * the one place a person looks to see whether a plugin is healthy.
 *
 * The same shape as the `listCards` contract fix, and for the same reason. A
 * published contract stricter than its code is a contract nothing can trust.
 */

// Each creator's own extra required field, so the payloads below are explicit
// and a shared helper cannot quietly supply the very field under assertion.
const CREATORS = [
  ["createCard", cardRpcContract.createCard, {}],
  ["createResearchCard", lifecycleRpcContract.createResearchCard, { strategy: "x" }],
  ["createExploreCard", lifecycleRpcContract.createExploreCard, { stageId: "x" }],
];

for (const [name, entry, extra] of CREATORS) {
  const input = entry.input;
  const base = { prompt: "p", ...extra };

  // The host's probe: no environment. This is the call that was refused.
  const probe = input.safeParse({ projectId: "proj_1", ...base });
  assert.equal(
    probe.success,
    true,
    `${name} must accept the probe's shape: ${JSON.stringify(probe.error?.issues ?? [])}`,
  );

  // A named environment still rides along, and so does every other field.
  assert.equal(
    input.safeParse({ projectId: "proj_1", ...base, environment: { type: "project-default" } }).success,
    true,
    `${name} still accepts an explicit environment`,
  );

  // Narrowing to optional must not open the object up: still strict, still typed.
  assert.equal(
    input.safeParse({ projectId: "proj_1", ...base, unexpected: true }).success,
    false,
    `${name} still refuses an unexpected field`,
  );
  assert.equal(
    input.safeParse({ ...base }).success,
    false,
    `${name} still requires projectId`,
  );
  assert.equal(
    input.safeParse({ projectId: "proj_1", ...extra }).success,
    false,
    `${name} still requires a prompt`,
  );
}

// The handler side of the claim, so the contract cannot drift away from it: an
// absent request really does resolve to the fallback, which is what makes the
// contract honest in the first place.
const fallback = { type: "host", workspace: { type: "project" } };
assert.equal(
  selectCardEnvironment(undefined, fallback),
  fallback,
  "an absent environment resolves to the workspace's own — the handler genuinely supports the omission",
);
assert.equal(
  selectCardEnvironment(null, fallback),
  fallback,
  "and so does an explicit null",
);
assert.equal(
  selectCardEnvironment("nonsense", fallback),
  fallback,
  "and so does a value that is not a recognised request",
);
assert.deepEqual(
  selectCardEnvironment({ type: "project-default" }, fallback),
  { type: "project-default" },
  "a real request is still honoured, so the contract is not a blanket",
);

console.log("card creator environment test ok: the three creators admit the call their handler already answers");
