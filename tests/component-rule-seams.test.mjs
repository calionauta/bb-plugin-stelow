// Executable tests for the rules behind the two component hooks the oversized
// state hooks were split into. The hooks themselves are thin bindings over these
// module-level rules — a fake rpc and a set of sinks are the whole harness — so
// each case below is a claim about behavior, not about where a string sits. Each
// section carries its own negative control: an input the rule must refuse, or a
// double that applies the updater it is handed, so a rule that stopped refusing —
// or a rule whose "no-op" quietly became a no-op test — fails here.
import assert from "node:assert/strict";
import { listCandidates } from "../components/github/github-import-query.ts";
import { importEach } from "../components/github/github-import-submit.ts";
import { deleteRule, refreshRules, toggleRule } from "../components/github/github-automation-rules.ts";
import { saveRule } from "../components/github/github-automation-form.ts";
import { anchorAutomationProject } from "../components/github/github-dialog-tabs.ts";
import { savePreset, runPresetAction } from "../components/settings/preset-manager-crud.ts";
import { defaultForm, openForm } from "../components/settings/preset-manager-form-state.ts";
import { presetManagerRouting } from "../components/settings/preset-manager-routing-props.ts";

/** An rpc that records every call and answers from a table. */
function rpcDouble(answers = {}) {
  const calls = [];
  return {
    calls,
    names: () => calls.map((call) => call.name),
    find: (name) => calls.find((call) => call.name === name),
    call: async (name, args) => {
      calls.push({ name, args });
      if (!(name in answers)) throw new Error(`unstubbed rpc: ${name}`);
      const answer = answers[name];
      return typeof answer === "function" ? answer(args) : answer;
    },
  };
}

const noop = () => {};

// --- import query ----------------------------------------------------------
// A query with no labels clears instead of fetching: an emptied chip set is an
// edit, and leaving the previous list under an empty query would read as "these
// still match".
{
  const rpc = rpcDouble({ listGithubCandidates: { issues: [], allLabels: [], allAssignees: [] } });
  const sinks = { importCandidates: [], importSelected: {}, allLabels: null, allAssignees: null, cleared: 0, busy: [] };
  const bind = {
    importLabels: [],
    clearCandidates: () => { sinks.cleared += 1; },
    setImportCandidates: (issues) => { sinks.importCandidates = issues; },
    setImportSelected: (selected) => { sinks.importSelected = selected; },
    setImportAllLabels: (labels) => { sinks.allLabels = labels; },
    setImportAllAssignees: (assignees) => { sinks.allAssignees = assignees; },
  };
  const setBusy = (busy) => sinks.busy.push(busy);
  await listCandidates(rpc, setBusy, bind, []);
  assert.deepEqual(rpc.names(), [], "an empty label set never reaches the server");
  assert.equal(sinks.cleared, 1, "an empty label set clears the stale candidates");
  assert.deepEqual(sinks.busy, [], "nothing was started, so nothing is marked busy");

  await listCandidates(rpc, setBusy, bind, [" stelow-work ", ""]);
  assert.deepEqual(rpc.find("listGithubCandidates").args, { labels: ["stelow-work"] }, "labels are trimmed and blanks dropped");
  assert.deepEqual(sinks.busy, [true, false], "a fetch owns the busy flag start to finish");
  assert.deepEqual(sinks.importCandidates, [], "the cleared state stays cleared for a stubbed empty page");
}

// --- import submit ---------------------------------------------------------
// One issue failing must not cost the human the rest of the batch, and a skipped
// import is not a success.
{
  const rpc = rpcDouble({
    importGithubIssue: ({ number }) => (number === 2
      ? { ok: true, skipped: "in-flight" }
      : number === 3
        ? { ok: false, skipped: null }
        : { ok: true, skipped: null }),
  });
  const issues = [1, 2, 3, 4].map((number) => ({ repo: "a/b", number }));
  const counted = await importEach(rpc, issues, ["stelow-work"], false, false);
  assert.deepEqual(counted, { imported: 2, inFlight: 1 }, "only real imports and real in-flights are counted");
  assert.deepEqual(rpc.find("importGithubIssue").args, {
    repo: "a/b", number: 1, labels: ["stelow-work"], start: false, isolated: false,
  }, "the two start choices are the caller's, never the component's");
}

// --- automation rules ------------------------------------------------------
// A toggle must not wipe the rule it is toggling, and a load for a project with
// no id is an empty list rather than a call.
{
  const rule = {
    id: "r1", projectId: "p1", labels: ["a"], trustedAuthors: ["ana"],
    promptTemplate: "t", startImmediate: true, enabled: true,
  };
  const rules = { automationRules: [rule], setAutomationRules: noop };
  const rpc = rpcDouble({
    saveAutomationRule: { rule: { ...rule, enabled: false } },
    deleteAutomationRule: { error: null },
  });
  await toggleRule(rpc, rules, "r1", false);
  assert.deepEqual(rpc.find("saveAutomationRule").args, { ...rule, enabled: false }, "the toggle passes the whole rule back");

  // Negative control target: a rule that is not in the list is not toggled.
  await toggleRule(rpc, { automationRules: [], setAutomationRules: noop }, "r1", false);
  assert.equal(rpc.names().filter((name) => name === "saveAutomationRule").length, 1, "an unknown rule id is not saved");

  const listed = [];
  await refreshRules(rpc, (value) => listed.push(value), null);
  assert.deepEqual(listed, [[]], "a project with no id resolves to no rules and no call");
  assert.deepEqual(rpc.names(), ["saveAutomationRule"], "the null-project load never reached the server");

  // The updater is a reducer, so the double applies it: a fake that only records
  // the argument would pass whatever the rule returned.
  let current = [rule];
  const seen = [];
  await deleteRule(rpc, (updater) => { current = updater(current); seen.push(current); }, "r1");
  assert.deepEqual(seen.at(-1), [], "a deleted rule leaves the list");
}

// --- automation form -------------------------------------------------------
// An incomplete form is not an error: no project, or no label, posts nothing.
{
  const form = {
    ruleProjectId: null, automationLabels: ["a"], automationAuthorsInput: "",
    automationPromptInput: "", automationStart: false, setBusy: noop, reloadRules: noop,
  };
  const rpc = rpcDouble({});
  await saveRule(rpc, form);
  assert.deepEqual(rpc.names(), [], "a save with no project posts nothing");
  await saveRule(rpc, { ...form, ruleProjectId: "p1", automationLabels: [] });
  assert.deepEqual(rpc.names(), [], "a save with no label posts nothing");
}

// --- the shared anchor -----------------------------------------------------
{
  const projects = [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }];
  assert.equal(anchorAutomationProject("p9", projects), "p9", "the board's project wins when it has one");
  assert.equal(anchorAutomationProject(null, projects), "p1", "no board project falls back to the first");
  assert.equal(anchorAutomationProject(null, []), null, "no project at all is null, never a guess");
}

// --- preset manager --------------------------------------------------------
// A refused delete is not a success: the server reports a refusal as `error` on
// a call that resolved.
{
  const rpc = rpcDouble({ deletePreset: { error: "Preset is in use." } });
  const messages = [];
  let reloaded = 0;
  await runPresetAction(rpc, { id: "p1", name: "Fast" }, "deletePreset", noop, (m) => messages.push(m), async () => { reloaded += 1; });
  assert.deepEqual(messages, [null, "Preset is in use."], "the message is cleared, then the refusal is what the human reads");
  assert.equal(reloaded, 1, "the list still refreshes: the server may have changed something");

  const ok = rpcDouble({ setDefaultPreset: { error: null } });
  const done = [];
  await runPresetAction(ok, { id: "p1", name: "Fast" }, "setDefaultPreset", noop, (m) => done.push(m), async () => {});
  assert.deepEqual(done.at(-1), "Fast is now the default.", "a successful call reports the outcome in words");}

// A nameless preset never reaches the server; a named one carries the form's
// own fields, with the two the manager does not manage pinned to null rather
// than omitted.
{
  const managerForm = {
    id: null, name: "  ", providerId: "x", modelId: "m",
    reasoningLevel: "high", permissionMode: "ask", environmentKind: "local",
  };
  const state = { form: managerForm, setForm: noop };
  const rpc = rpcDouble({ upsertPreset: { preset: { id: "p9", name: "Fast" } } });
  const messages = [];
  await savePreset(rpc, { state, setBusy: noop, setMessage: (m) => messages.push(m), onChanged: async () => {} });
  assert.deepEqual(messages, ["Name is required."], "a nameless save is refused locally with a message");
  assert.deepEqual(rpc.names(), [], "and never reaches the server");

  const named = rpcDouble({ upsertPreset: { preset: { id: "p9", name: "Fast" } } });
  const saved = [];
  const namedForm = { ...managerForm, name: " Fast " };
  // The form setter is a reducer, so the double applies it: recording the
  // argument alone would pass a rule that stopped writing the id back.
  const forms = [];
  const recordForm = (next) => {
    forms.push(typeof next === "function" ? next(namedForm) : next);
  };
  await savePreset(named, {
    state: { form: namedForm, setForm: recordForm },
    setBusy: noop,
    setMessage: noop,
    onChanged: async () => { saved.push("changed"); },
  });
  assert.deepEqual(named.find("upsertPreset").args, {
    id: null, name: "Fast", providerId: "x", modelId: "m", reasoningLevel: "high",
    permissionMode: "ask", environmentKind: "local", baseBranch: null, machineId: null, instructions: "",
  }, "the saved name is trimmed and the unmanaged fields are explicit nulls");
  assert.deepEqual(saved, ["changed"], "a successful save refreshes the list");
  // The saved id is what makes the next save an update rather than a copy.
  assert.equal(forms.at(-1).id, "p9", "the id the server assigned is written through the form");
  await savePreset(named, {
    state: { form: { ...managerForm, name: "Fast", id: "p9" }, setForm: recordForm },
    setBusy: noop,
    setMessage: noop,
    onChanged: async () => {},
  });
  assert.equal(named.calls.at(-1).args.id, "p9", "an existing preset is sent with its id, so the save updates it");
}

// A new preset starts from the default's fields, and the id and name are cleared
// so the next save is a new preset rather than an overwrite of the default.
{
  const presets = [
    { id: "p1", name: "Fast", isDefault: true, providerId: "openai" },
    { id: "p2", name: "Deep", isDefault: false, providerId: "anthropic" },
  ];
  const fresh = defaultForm(presets);
  assert.equal(fresh.providerId, "openai", "the default's settings are the starting point");
  assert.equal(fresh.id, null, "the new preset owns no id yet");
  assert.equal(fresh.name, "", "the name is the human's to write");
  assert.equal(defaultForm([]).id, null, "no presets at all is the empty form, with no id to update");
  assert.equal(defaultForm([presets[1]]).providerId, "anthropic", "with no default, the first preset is the starting point");
  const opened = [];
  openForm(fresh, (f) => opened.push(["form", f.name]), (o) => opened.push(["open", o]), (m) => opened.push(["message", m]));
  assert.deepEqual(opened, [["form", ""], ["open", true], ["message", null]], "opening clears the last message");
}

// The routing props are assembled once, so the two sections cannot disagree.
{
  const assignments = {
    bands: [], setBands: noop, generationPreset: null, setGenerationPreset: noop,
    reliablePreset: null, setReliablePreset: noop, reviewerPreset: null, setReviewerPreset: noop,
  };
  const crud = { busy: false, setBusy: noop, setMessage: noop };
  const rpc = rpcDouble();
  const onChanged = async () => {};
  const presets = [{ id: "p1", name: "Fast", isDefault: true }];
  const built = presetManagerRouting(rpc, presets, assignments, crud, onChanged);
  // Every field must come from the inputs, not from a literal: a hard-coded
  // value in the assembler would pass every "is it wired" check below.
  assert.deepEqual(
    presetManagerRouting(rpc, presets, assignments, crud, onChanged),
    built,
    "the same inputs give the same wiring",
  );
  assert.equal(built.busy, false);
  assert.deepEqual(built.bands, assignments.bands);
  for (const key of ["onBandsChange", "onMessage", "onBusyChange", "onReliableChange", "onGenerationChange", "onReviewerChange"]) {
    assert.equal(typeof built[key], "function", `${key} is wired, not dropped`);
  }
  assert.equal(built.onMessage, crud.setMessage, "the message setter is the crud one, not a copy");
  assert.equal(built.onBandsChange, assignments.setBands, "the bands setter is the assignments one");
}

console.log(
  "component rule seams ok: import query and submit, automation rules and form, "
  + "project anchor, preset actions and form",
);
