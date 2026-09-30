import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { presetEnvironmentSeed } from "../lib/preset-environment-seed.mjs";
import { savePreset } from "../components/settings/preset-manager-crud.ts";

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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fieldSource = readFileSync(
  join(root, "components/settings/preset-environment-kind-field.tsx"),
  "utf8",
);
const rowSource = readFileSync(
  join(root, "components/settings/preset-manager-preset-row.tsx"),
  "utf8",
);

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

// The control is a checkbox, not a pair of named options. A "Project checkout"
// option cannot keep its promise, so the shape that survives is the one that
// makes only a statement it can honour.
{
  assert.doesNotMatch(
    fieldSource,
    /type="radio"/,
    "no radio option exists, so no stored value is presented as a checkout the card will not get",
  );
  assert.doesNotMatch(
    fieldSource,
    /type="checkbox"[\s\S]{0,400}type="radio"/,
    "the control never mixes a checkbox with a named option pair",
  );
  assert.match(
    fieldSource,
    /type="checkbox"/,
    "the environment kind is authored through a checkbox",
  );
  // The two values the control writes. Pinned as behaviour (what a click
  // produces), not as the mere presence of the strings: a copy grep would pass
  // on a control that wrote neither.
  assert.match(
    fieldSource,
    /environmentKind:\s*event\.target\.checked\s*\?\s*WORKTREE_KIND\s*:\s*"project-default"/,
    "checking writes the worktree kind and clearing it writes the checkout kind",
  );
}

// The label has one home. The import dialog declares this file's concept a
// single source; re-declaring the words here is how two surfaces drift.
{
  assert.match(
    fieldSource,
    /import \{ ISOLATED_WORKTREE_LABEL \} from "\.\.\/isolated-worktree-check"/,
    "the concept's name is imported from its declared single source, not retyped",
  );
  // The import dialog's benefit sentence describes an agent and a card. On a
  // preset there is no agent yet, and the person may change the setting, so
  // reusing it would state something untrue in this location.
  assert.doesNotMatch(
    fieldSource,
    /ISOLATED_WORKTREE_BENEFIT/,
    "the import dialog's benefit sentence is not reused, because it describes a card rather than a preset",
  );
  // Its detail list tells the reader to create the very preset this dialog
  // authors.
  assert.doesNotMatch(
    fieldSource,
    /ISOLATED_WORKTREE_DETAILS/,
    "the import dialog's detail list is not reused: one of its lines tells the reader to create this preset",
  );
}
{
  // Both disabled conditions are load-bearing. One stops a save racing the
  // field; the other stops a built-in's kind from cascading into every
  // auto-started worker and every preset created afterwards.
  assert.match(
    fieldSource,
    /disabled=\{disabled\}/,
    "the control's disabled state is driven by the busy and built-in conditions",
  );
  assert.match(
    fieldSource,
    /const disabled = busy \|\| builtIn;/,
    "and those two conditions are what combine to produce it",
  );
  // A pointer cursor on a permanently disabled control promises a click that
  // never lands — which is the built-in case, every time.
  assert.match(
    fieldSource,
    /cursor-default/,
    "the control drops the pointer cursor when it cannot be clicked",
  );
}

// The explanation carries the built-in cascade and the out-of-enum value, and
// those sentences are the ONLY place either fact appears. If they do not reach
// assistive tech, a screen-reader user meets a disabled control with no reason.
{
  assert.match(
    fieldSource,
    /aria-describedby=\{HELP_ID\}/,
    "the input points at its explanation so it is announced on demand",
  );
  assert.match(
    fieldSource,
    /id=\{HELP_ID\}/,
    "and the explanation carries the id that reference resolves to",
  );
}

// Focus must be perceivable per WCAG 2.2. The spec named ChoiceCards' treatment
// as the house style, and no global outline reset exists in this repo, so the
// control supplies its own.
{
  assert.match(
    fieldSource,
    /focus-visible:outline/,
    "the checkbox carries its own visible focus treatment",
  );
}

// Touch targets are a house rule that AGENTS.md admits is stated but untested.
//
// COUNTED, not presence-matched. A presence grep over the whole file passes on a
// control whose JSX lost both classes and whose only remaining occurrence is
// the word inside a comment — which is exactly how this assertion was found
// green on a broken control during verification. Counting inside the JSX
// distinguishes a class-order refactor from a dropped class.
{
  const count = (needle) => fieldSource.split(needle).length - 1;
  assert.ok(
    count("min-h-11") >= 1,
    `the control's label carries the house minimum touch target (found ${count("min-h-11")})`,
  );
  // The label and the input are both clickable, so both must resolve a pointer.
  // The cursor is one interpolated variable, so the assertion counts where it is
  // APPLIED (two className sites) rather than how many times the word appears —
  // a count of the literal alone would pass on a label that dropped it.
  const applied = fieldSource.match(/className=\{`[^`]*\$\{cursor\}/g) ?? [];
  assert.ok(
    applied.length >= 2,
    `the label and the input each carry the pointer cursor (found ${applied.length} sites)`,
  );
  assert.match(
    fieldSource,
    /disabled \? "cursor-default" : "cursor-pointer"/,
    "and the cursor drops to a default when the control cannot be clicked",
  );
}

// The preset list must distinguish a worktree preset without opening it, and
// the indicator cannot live inside the meta span: that span truncates, so
// anything added in there is ellipsised and never renders.
{
  assert.match(
    rowSource,
    /environmentKind === "new-worktree"\s*\?\s*<Pill>worktree<\/Pill>\s*:\s*null/,
    "a worktree preset is marked in the list, and only a worktree preset is",
  );
  const indicator = rowSource.indexOf("environmentKind === \"new-worktree\"");
  const truncate = rowSource.indexOf("truncate");
  assert.ok(
    truncate !== -1 && indicator > truncate,
    "the row still truncates its meta line",
  );
  assert.ok(
    /<span className="min-w-0 flex-1 truncate">[\s\S]*?<\/span>\s*\{preset\.isDefault/.test(rowSource),
    "the indicator is a sibling of the truncating meta span, never inside it",
  );
}

// The seed is wired into THREE dialogs, and each one must actually pass it.
//
// Counted per dialog rather than once over the folder: a single assertion that
// "some dialog seeds the composer" stays green when one dialog silently stops
// doing it, which is precisely the mutation verification performed — deleting
// the prop from the Explore dialog alone left every suite green.
const DIALOGS = [
  "create-build-dialog.tsx",
  "create-research-dialog.tsx",
  "create-explore-dialog.tsx",
];
for (const dialog of DIALOGS) {
  const source = readFileSync(join(root, "components/creation", dialog), "utf8");
  assert.match(
    source,
    /useSeededComposerEnvironment\(/,
    `${dialog} reads the preset's environment kind`,
  );
  assert.match(
    source,
    /defaultEnvironment=\{seededEnvironment\}/,
    `${dialog} hands the seed to the composer`,
  );
  // The reset key is what makes "reopening re-reads the preset" true. The hook
  // sits ABOVE <Dialog>, and Radix unmounts DialogContent on close — not the
  // component holding the hook — so a mount-once capture would survive a close
  // and a reopen and keep showing a stale preset.
  assert.match(
    source,
    /useSeededComposerEnvironment\([^)]*,\s*open\)/,
    `${dialog} re-reads the preset on reopen rather than capturing once per panel mount`,
  );
}
{
  // And the hook itself must hold the capture rather than recompute per render.
  // The mapper's frozen constant is the first line of defence; this is the
  // second, and it is the one AC 3 names.
  const hook = readFileSync(
    join(root, "components/creation/composer-environment-seed.ts"),
    "utf8",
  );
  assert.match(
    hook,
    /captured\.current\?\.open !== open/,
    "the capture is keyed on the dialog's open state, so a reopen re-reads the preset",
  );
  assert.match(
    hook,
    /useRef/,
    "the capture survives re-renders, so a person who touched the picker keeps their pick",
  );
  assert.doesNotMatch(
    hook,
    /return presetEnvironmentSeed\(environmentKind\);/,
    "the hook never recomputes per render, which is the re-seed defence AC 3 depends on",
  );
}

console.log(
  "preset environment seed test ok: the mapping is total and reference-stable, "
  + "an unknown kind is refused locally, the control is a checkbox that claims "
  + "only a worktree, and all three dialogs seed the composer on every open",
);