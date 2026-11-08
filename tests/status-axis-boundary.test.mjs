import assert from "node:assert/strict";
import test from "node:test";
import { CARD_STATUSES, readCardStatus } from "../lib/card-status.mjs";
import * as cardStatus from "../lib/card-status.mjs";
import { TRACKABLE_STATUSES } from "../lib/trackables.mjs";
import { cardStatusSchema, trackableStatusSchema } from "../server/contracts.ts";
import { normalizeStatus } from "../server/scopes.ts";
import { loadComponent } from "./helpers/render-component.mjs";

/**
 * The three lists that describe the same two axes, pinned to the two machines.
 *
 * A card's status was read through the SCOPE normalizer in ten places, and it
 * only ever worked by accident: the scope vocabulary was a twelve-value superset
 * that happened to contain all five card statuses, so every value passed through
 * unchanged. Describing the scope vocabulary accurately — which is what the rest
 * of this work did — turns that accident into a live fault. `normalizeStatus`
 * returns `pending` for `draft` and `archived`, and every guard of the form
 * `normalizeStatus(card.status) === "archived"` silently starts answering false:
 * a card that cannot be archived, and a board that cannot tell an archived card
 * from a live one.
 *
 * The compiler caught it, which is worth saying plainly: narrowing the scope
 * vocabulary produced a type error that pointed at `rpc-surfaces.ts`, four files
 * from the annotation that was wrong. The wiring had been passing `card.status`
 * through a pendency's reader for long enough that nobody could see it.
 *
 * These tests exist so that neither half can drift again, and so the RPC boundary
 * is checked as a BOUNDARY: `planning` and `approved` are the two values no write
 * path can produce, and a schema that accepts them can never fail fast on one
 * that matters.
 */

test("the RPC boundary accepts a card status and refuses what no writer produces", () => {
  // Drive the schema, not the list. These are OUTPUT schemas, so the honest
  // framing is that they catch rather than admit: an invented status is what they
  // exist to refuse on the way out, not something that could get in through them.
  for (const status of CARD_STATUSES) {
    assert.doesNotThrow(
      () => cardStatusSchema.parse(status),
      `${status} is writable, so the boundary must accept it`,
    );
  }
  for (const unreachable of ["planning", "approved"]) {
    assert.equal(
      cardStatusSchema.safeParse(unreachable).success,
      false,
      `${unreachable} is a stage name / scope-MAP status and no card write produces it`,
    );
  }
});

test("the RPC boundary accepts every trackable status a scope can hold", () => {
  for (const status of TRACKABLE_STATUSES) {
    assert.doesNotThrow(() => trackableStatusSchema.parse(status), `${status} must be accepted`);
  }
  // The two axes do not overlap completely, and the split is what proves it: a
  // card's five and a trackable's eight share `pending`, `in-progress` and
  // `completed`, and a card status that is not a trackable status must be
  // refused here rather than silently accepted by a merged enum.
  assert.equal(cardStatusSchema.safeParse("draft").success, true);
  assert.equal(trackableStatusSchema.safeParse("draft").success, false);
  assert.equal(trackableStatusSchema.safeParse("archived").success, false);
});

test("the schema lists are the machine's lists, not a second copy", () => {
  // Deriving them was tried and reverted: a `.ts` file cannot take a type from a
  // `lib/*.mjs` constant in this tree without duplicating a type identity
  // through the whole RPC graph. So they are written out and pinned here, and
  // `server/contracts.ts` records why rather than leaving it to be rediscovered.
  assert.deepEqual([...cardStatusSchema.options], [...CARD_STATUSES]);
  assert.deepEqual([...trackableStatusSchema.options], [...TRACKABLE_STATUSES]);
});

test("the two axes together account for every status the boundary accepts", () => {
  // The axes DO overlap — `pending`, `in-progress` and `completed` are both a
  // card's and a pendency's — and that is fine and expected. What has to hold is
  // that the boundary accepts exactly the union of the two machines: no value
  // outside them, and none of them refused.
  //
  // An earlier version of this test asserted the schemas shared no value at all.
  // That was false, and asserting it would have failed for the right reason on
  // correct code — a test whose subject is a stricter world than the one that
  // ships is a test that gets deleted instead of fixed.
  const accepted = new Set([...cardStatusSchema.options, ...trackableStatusSchema.options]);
  const machines = new Set([...CARD_STATUSES, ...TRACKABLE_STATUSES]);
  assert.deepEqual([...accepted].filter((v) => !machines.has(v)), []);
  assert.deepEqual([...machines].filter((v) => !accepted.has(v)), []);
  // And the overlap is exactly the three a reader would expect, which is what
  // makes the split safe rather than a source of new refusals.
  assert.deepEqual(
    cardStatusSchema.options.filter((s) => trackableStatusSchema.options.includes(s)).sort(),
    ["completed", "in-progress", "pending"],
  );
});

test("a scope's status is a trackable status, and a legacy value reads as pending", () => {
  // `normalizeStatus` is the scope reader and stays one. Narrowing it to the
  // machine's eight is the change that surfaced the card bug above; the coercion
  // is the behaviour that makes it safe, so it is pinned rather than assumed.
  for (const status of TRACKABLE_STATUSES) {
    assert.equal(normalizeStatus(status), status, `${status} survives the read`);
  }
  for (const legacy of ["draft", "planning", "approved", "archived"]) {
    assert.equal(
      normalizeStatus(legacy),
      "pending",
      `${legacy} is not a pendency status and must not pass through as one`,
    );
  }
  assert.equal(normalizeStatus(undefined), "pending");
  assert.equal(normalizeStatus("nonsense"), "pending");
});

test("a card's status reads through the card reader, so archive still works", () => {
  // The regression, stated as a test. With card status read through the scope
  // normalizer, every one of these returned "pending" and every archive guard
  // silently passed a live card as archived.
  for (const status of CARD_STATUSES) {
    assert.equal(readCardStatus(status), status, `${status} reads back unchanged`);
  }
  assert.equal(readCardStatus("draft"), "draft");
  assert.equal(readCardStatus("archived"), "archived");
  assert.equal(readCardStatus("pending"), "pending");
  // An unknown card status is `draft` — not started — and never a pendency word.
  assert.equal(readCardStatus("nonsense"), "draft");
  assert.equal(readCardStatus(undefined), "draft");
  assert.equal(readCardStatus(null), "draft");
});

/** Any property at any depth resolves to a callable no-op, so `createHostSurfaces`
 * can destructure a fake core without a forty-field fixture. The stubs below
 * record the deps object the wiring builds and never call back into it, so the
 * core is only read, never exercised. */
function anySurface() {
  const surface = function () { return anySurface(); };
  return new Proxy(surface, {
    get: () => anySurface(),
    apply: () => anySurface(),
  });
}

test("the production wiring hands out the card reader, not the scope one", () => {
  // EXECUTED through the composition seam, not read out of it. Every harness in
  // this repo builds its deps directly instead of going through
  // `host-surfaces.ts`, which is the right way to keep a fake small and the
  // wrong way to notice that the PRODUCER of `cardStatusOf` was rewired: an
  // adversarial pass changed the provider to the scope normalizer and every
  // harness-backed suite stayed green, because none of them ever asked the
  // provider. So this calls the composition function with the two consumers
  // stubbed to record the deps they are handed, then asks each wired provider
  // what a card status reads back as. A provider swapped to `normalizeStatus`
  // answers `pending` for `draft` and `archived`, and fails here.
  let issueDeps = null;
  let publicationDeps = null;
  const createHostSurfaces = loadComponent(
    "server/runtime/wiring/host-surfaces.ts",
    "createHostSurfaces",
    {
      "../../github-issues.js": {
        createGithubAutomation: (deps) => { issueDeps = deps; return {}; },
      },
      "../../artifacts-publication.js": {
        createArtifactsPublication: (deps) => { publicationDeps = deps; return {}; },
      },
      "../platform.js": { createPlatformHandlers: () => ({}) },
      "../composition.js": { registerAutomationSchedule: () => {}, registerWorkerSkills: () => {} },
      "../mentions.js": { registerMentionProviders: () => {} },
      "../../scopes.js": { loadCardScopes: () => [], normalizeStatus },
      "../../../lib/card-status.mjs": cardStatus,
      "../../../lib/trackables.mjs": { trackableStatusLabel: (status) => status },
      "../../plugin-paths.js": {
        BUILD_INFO: {},
        PLUGIN_SKILLS_DIR: "",
        pluginDir: "",
        readPinnedStelowVersion: () => null,
      },
    },
  );
  createHostSurfaces({ core: anySurface(), cards: anySurface(), github: () => {} });

  const providers = [issueDeps?.cards?.cardStatusOf, publicationDeps?.cardStatusOf];
  for (const provider of providers) {
    assert.equal(typeof provider, "function", "the wiring hands out a status provider");
    for (const status of CARD_STATUSES) {
      assert.equal(provider(status), status, `${status} reads back through the wired provider`);
    }
    assert.equal(provider("archived"), "archived", "an archived card still reads as archived, so its guards still guard");
  }
});
