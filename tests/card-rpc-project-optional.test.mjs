import assert from "node:assert/strict";
import { cardRpcContract } from "../server/card-rpc-contract.ts";

/**
 * A published contract must say what the handler can actually do.
 *
 * `listCards` answers "every project" when `projectId` is absent — `queryCards`
 * simply omits the project filter. The contract said `projectId: z.string()
 * .nullable()`, which reads as "may be null" but not "may be absent", and a
 * non-optional property is exactly what the host's schema derivation reports
 * as REQUIRED. So the host's own plugin probe, which omits it, was refused at
 * validation for a call the handler supports — and the refusal surfaced on the
 * plugin's status line, the one place a user looks to see whether a plugin is
 * healthy.
 *
 * `.nullable()` claimed the value could be missing. Only `.optional()` makes
 * that true of the published contract as well.
 */

const input = cardRpcContract.listCards.input;

// O probe do host: sem projectId, so a listagem de todos os projetos.
const everyProject = input.safeParse({});
assert.equal(everyProject.success, true, `a caller may omit projectId: ${JSON.stringify(everyProject.error?.issues ?? [])}`);

// A non-optional property is what the host's derivation reports as REQUIRED, so
// the runtime tolerance above is only half the pin; the validator itself is
// checked here, and the derived schema is checked by the host probe that failed.
assert.equal(
  input.safeParse({ projectId: null }).success,
  true,
  "an explicit null is still valid",
);
assert.equal(input.safeParse({ projectId: "proj_1" }).success, true, "a project id is valid");
assert.equal(
  input.safeParse({ projectId: "p", kind: "build" }).success,
  true,
  "the optional track filter still rides along",
);

// The contract is strict, so narrowing it must not open it up wholesale.
assert.equal(input.safeParse({ projectId: "p", kind: "nope" }).success, false, "an unknown track is still refused");
assert.equal(input.safeParse({ unexpected: true }).success, false, "an unexpected field is still refused");
assert.equal(input.safeParse({ projectId: 7 }).success, false, "a non-string project id is still refused");

console.log("card rpc contract test ok: listCards may omit projectId, which is what the handler does");
