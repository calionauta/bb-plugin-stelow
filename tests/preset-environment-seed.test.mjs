import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureEnvironmentSeed,
  isKnownEnvironmentKind,
  presetEnvironmentSeed,
  storableEnvironmentKind,
} from "../lib/preset-environment-seed.mjs";
import { savePreset } from "../components/settings/preset-manager-crud.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// What a preset's stored environment kind becomes when a card starts.
//
// The stored words and the wire words are NOT the same vocabulary, and getting
// this mapping wrong is the failure the whole feature exists to remove:
//
//   - Stelow's "project-default" means the SHARED CHECKOUT
//     (server/workers.ts returns host/unmanaged/path for it).
//   - BB's own {type:"project-default"} means a MANAGED WORKTREE when git
//     permits. The plugin's "new-worktree" path only works through that
//     inversion.
//
// So neither stored value may be forwarded verbatim. The worktree is *stated*
// as host/managed-worktree, which BB cannot redefine underneath us, and the
// checkout is not seeded at all because the SDK documents
// {type:"project-default"} as "seeds nothing".

// The mapper itself, called rather than read: this is where a wrong kind would
// put a card in a checkout the person asked to avoid.
{
  const worktree = presetEnvironmentSeed("new-worktree");
  assert.deepEqual(worktree, {
    type: "host",
    workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
  }, "a worktree preset states a managed worktree rather than delegating to BB's token");

  // Deliberately NOT {type:"project-default"}: that name means a worktree to BB
  // and a shared checkout to us, so forwarding it would ask BB to guess.
  assert.notEqual(
    worktree?.type,
    "project-default",
    "the seed never leans on the one name whose meaning the two layers disagree about",
  );
  assert.equal(worktree?.workspace?.type, "managed-worktree", "the workspace type carries the intent, not the host token");
}
{
  // Reference stability is the whole re-seed defence. The SDK value-compares
  // its default* props each render and re-seeds EVERY selection when one
  // changes; a fresh object literal per call would be a new value per render.
  assert.equal(
    presetEnvironmentSeed("new-worktree"),
    presetEnvironmentSeed("new-worktree"),
    "two calls return one reference, so a re-render is not a re-seed",
  );
  assert.equal(
    Object.isFrozen(presetEnvironmentSeed("new-worktree")),
    true,
    "the shared seed is frozen, so a caller cannot mutate the constant for everyone",
  );
}

// Total by design: a kind the schema never produced must not block card
// creation, and must behave exactly as it does today — which is no seed.
{
  assert.equal(presetEnvironmentSeed("project-default"), undefined, "a checkout preset seeds nothing and lets BB resolve its own default");
  assert.equal(presetEnvironmentSeed("local"), undefined, "an unrecognised stored value degrades to today's behaviour");
  assert.equal(presetEnvironmentSeed(""), undefined, "an empty value is not a worktree");
  assert.equal(presetEnvironmentSeed(null), undefined, "a missing value is not a worktree");
  assert.equal(presetEnvironmentSeed(undefined), undefined, "an absent value is not a worktree");
}

// The dialog refuses a kind it cannot set, instead of handing the server a
// value its schema rejects. The RPC's zod enum would render as a raw
// validation string in the form's single message line.
{
  const calls = [];
  const rpc = {
    call: (method, args) => {
      calls.push([method, args]);
      return Promise.resolve({ preset: { id: "p1", name: "Refused" } });
    },
  };
  const messages = [];
  const state = {
    form: {
      id: null,
      name: "Refused",
      providerId: "x",
      modelId: "m",
      reasoningLevel: "high",
      permissionMode: "ask",
      environmentKind: "local",
    },
    setForm: () => {},
  };
  await savePreset(rpc, {
    state,
    setBusy: () => {},
    setMessage: (message) => messages.push(message),
    onChanged: async () => {},
  });
  assert.deepEqual(
    calls,
    [],
    "an environment the schema never produced never reaches the server",
  );
  assert.equal(messages.length, 1, "the refusal is reported once, in the form's own message line");
  // A refusal naming neither the offending value nor the way out leaves the
  // reader with a statement they cannot act on.
  assert.match(
    messages[0],
    /local/,
    "the refusal names the value it could not accept",
  );
  assert.match(
    messages[0],
    /isolated worktree/i,
    "the refusal names the option that replaces it",
  );
}
{
  // The counter-case in the same contract: a valid kind is forwarded, so the
  // refusal above cannot be passing by refusing everything.
  const calls = [];
  const rpc = {
    call: (method, args) => {
      calls.push([method, args]);
      return Promise.resolve({ preset: { id: "p1", name: "Kept" } });
    },
  };
  const state = {
    form: {
      id: null,
      name: "Kept",
      providerId: "x",
      modelId: "m",
      reasoningLevel: "high",
      permissionMode: "ask",
      environmentKind: "new-worktree",
    },
    setForm: () => {},
  };
  await savePreset(rpc, {
    state,
    setBusy: () => {},
    setMessage: () => {},
    onChanged: async () => {},
  });
  assert.equal(calls.length, 1, "a valid environment reaches the server");
  assert.equal(
    calls[0][1].environmentKind,
    "new-worktree",
    "and it arrives as itself, not renamed on the way",
  );
}

// The capture rule is EXECUTED, not read out of the hook's source. The old
// assertion pinned the literal `captured.current?.open !== open`, which an
// unconditional guard satisfies while re-capturing on every render — verified,
// that mutation left the suite green while AC 3's executor was absent.
//
// This is the same defect the text pin was defending against, one layer down:
// the rule now lives in a pure function, so the property is a fact about a
// return value rather than a fact about a sentence.
{
  // Frozen for the visit: a preset changing underneath an open dialog.
  const first = captureEnvironmentSeed(null, true, "new-worktree");
  const second = captureEnvironmentSeed(first, true, "project-default");
  assert.equal(
    second.seed,
    first.seed,
    "a preset saved mid-dialog cannot re-seed over the choice already made",
  );
  assert.equal(
    second.seed?.workspace?.type,
    "managed-worktree",
    "and what survives is the seed the dialog opened with, not the newer preset",
  );
  assert.equal(second.open, true, "the same visit is still the same visit");

  // Reopening re-reads: this is the B3 behaviour, keyed on `open` because Radix
  // unmounts DialogContent (not the component holding the hook) on close.
  const closed = captureEnvironmentSeed(second, false, "new-worktree");
  assert.equal(closed.open, false, "closing the dialog ends the visit");
  const reopened = captureEnvironmentSeed(closed, true, "project-default");
  assert.equal(
    reopened.seed,
    undefined,
    "reopening re-reads the preset rather than replaying the first one",
  );

  // The no-seed case carries a real meaning, so the capture must freeze it too.
  const none = captureEnvironmentSeed(null, true, "project-default");
  assert.equal(none.seed, undefined, "a checkout preset seeds nothing");
  assert.equal(
    captureEnvironmentSeed(none, true, "new-worktree").seed,
    undefined,
    "and 'seed nothing' is frozen for the visit too, not re-read per render",
  );
}

// The hook holds the capture and DELEGATES the rule rather than restating it —
// two rules for one behaviour is how the text pin and the code drifted apart.
{
  const hook = readFileSync(
    join(root, "components/creation/composer-environment-seed.ts"),
    "utf8",
  );
  assert.match(
    hook,
    /useRef/,
    "the capture survives re-renders, so a person who touched the picker keeps their pick",
  );
  assert.match(
    hook,
    /captureEnvironmentSeed\(captured\.current, open, environmentKind\)/,
    "the hook delegates to the tested rule rather than restating it",
  );
  assert.doesNotMatch(
    hook,
    /presetEnvironmentSeed\(environmentKind\)/,
    "the hook never recomputes the seed per render, which is the re-seed defence AC 3 depends on",
  );
}

// The card-override path writes this column too, and it has no form to refuse
// in — so the out-of-enum case has to be settled before the wire, not after.
// The audit flagged this as unrecorded; forwarding `preset.environmentKind ??
// "project-default"` sent an upgraded install's unvalidated value straight into
// a zod enum and surfaced a raw validation string as a failed assignment.
{
  assert.equal(
    storableEnvironmentKind("new-worktree"),
    "new-worktree",
    "a worktree kind is stored as itself",
  );
  assert.equal(
    storableEnvironmentKind("project-default"),
    "project-default",
    "and so is a checkout kind",
  );
  for (const unreachable of ["local", "", null, undefined, "NEW-WORKTREE"]) {
    assert.equal(
      storableEnvironmentKind(unreachable),
      "project-default",
      `an out-of-enum kind (${JSON.stringify(unreachable)}) falls back to something storable`,
    );
  }
  // The two mappers answer different questions and must not drift into one
  // another: seeding is about the composer, storing is about the wire.
  assert.equal(
    isKnownEnvironmentKind("project-default"),
    true,
    "the default kind is in the schema",
  );
  assert.equal(isKnownEnvironmentKind("local"), false, "and an unrecognised one is not");

  const { classifyPresetSelection, runPresetAssignment } = await import(
    "../lib/preset-assignment.mjs"
  );
  const calls = [];
  const rpc = {
    call: (method, args) => {
      calls.push([method, args]);
      return Promise.resolve({ preset: { id: "card-override-1" } });
    },
  };
  await runPresetAssignment({
    rpc,
    cardId: "c1",
    selected: "custom",
    customValue: { providerId: "p", modelId: "m", environmentKind: "ignored" },
    defaultPreset: { environmentKind: "local", reasoningLevel: "high", permissionMode: "ask" },
  });
  assert.equal(
    calls[0]?.[1]?.environmentKind,
    "project-default",
    "the card-override write stores a value the schema can hold, not the row's raw one",
  );
  assert.ok(classifyPresetSelection("preset:p1").presetId === "p1", "the selection still classifies");
}

console.log(
  "preset environment seed test ok: the mapping is total and reference-stable, "
  + "an unrecognised kind is refused before the wire, and the capture freezes the "
  + "seed per visit so a re-render is not a re-seed",
);
