import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveReliablePreset,
  RELIABLE_SOURCE_CARD,
  RELIABLE_SOURCE_OVERRIDE,
  RELIABLE_SOURCE_BAND,
  RELIABLE_SOURCE_DEFAULT,
} from "../lib/reliable-preset.mjs";

// Reliable-tier override: an optional board-level preset that replaces the
// band preset for reliable spawns. Empty means today's behavior — the test
// that would catch a regression that silently re-routes workers (e.g. a
// cascade reorder that lets the band preset beat an explicit pin, or a
// spawn site that bypasses the resolver).

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = [
  readFileSync(join(root, "server.ts"), "utf8"),
  readFileSync(join(root, "server", "plugin-runtime.ts"), "utf8"),
  readFileSync(join(root, "server", "preset-migrations.ts"), "utf8"),
  readFileSync(join(root, "server", "preset-accessors.ts"), "utf8"),
  readFileSync(join(root, "server", "preset-handlers.ts"), "utf8"),
  readFileSync(join(root, "server", "platform-rpc-contract.ts"), "utf8"),
  readFileSync(join(root, "server/cards.ts"), "utf8"),
  readFileSync(join(root, "server/cards-create.ts"), "utf8"),
].join("\n");
const presetMigrations = readFileSync(
  join(root, "server", "preset-migrations.ts"),
  "utf8",
);
const presetHandlers = readFileSync(
  join(root, "server", "preset-handlers.ts"),
  "utf8",
);
const presetAccessors = readFileSync(
  join(root, "server", "preset-accessors.ts"),
  "utf8",
);
const cardsCreate = readFileSync(
  join(root, "server", "cards-create.ts"),
  "utf8",
);
const executionAdvance = readFileSync(
  join(root, "server", "execution-advance.ts"),
  "utf8",
);
const drafting = readFileSync(join(root, "server/drafting.ts"), "utf8");
const workerBackend = readFileSync(join(root, "server/workers.ts"), "utf8");
const managerBand = readFileSync(
  join(root, "components/settings/preset-manager-band-routing.tsx"),
  "utf8",
);

// Cascade order: card pin > reliable override > band > default. A reorder
// here changes which brain runs the worker, so each level is pinned.
assert.deepEqual(
  resolveReliablePreset({
    cardPin: "c",
    reliableOverride: "r",
    bandPreset: "b",
    defaultPreset: "d",
  }),
  { presetId: "c", source: RELIABLE_SOURCE_CARD },
  "the per-card pin beats everything",
);
assert.deepEqual(
  resolveReliablePreset({
    cardPin: null,
    reliableOverride: "r",
    bandPreset: "b",
    defaultPreset: "d",
  }),
  { presetId: "r", source: RELIABLE_SOURCE_OVERRIDE },
  "the reliable override replaces the band preset when set",
);
assert.deepEqual(
  resolveReliablePreset({
    cardPin: null,
    reliableOverride: null,
    bandPreset: "b",
    defaultPreset: "d",
  }),
  { presetId: "b", source: RELIABLE_SOURCE_BAND },
  "empty override falls back to the band preset (today's behavior)",
);
assert.deepEqual(
  resolveReliablePreset({
    cardPin: null,
    reliableOverride: null,
    bandPreset: null,
    defaultPreset: "d",
  }),
  { presetId: "d", source: RELIABLE_SOURCE_DEFAULT },
  "no band preset falls back to the card/board default",
);
assert.deepEqual(
  resolveReliablePreset({
    cardPin: "",
    reliableOverride: "",
    bandPreset: "",
    defaultPreset: "",
  }),
  { presetId: null, source: null },
  "empty strings resolve to nothing, never to a refusal downstream",
);

// Singleton table mirrors the generation_preset discipline: one row,
// cascade-cleared when its preset is deleted.
assert.match(
  presetMigrations,
  /for \(const table of \["review_preset", "generation_preset", "reliable_preset"\]/,
  "the singleton tables share one migration",
);
assert.match(
  presetMigrations,
  /id INTEGER PRIMARY KEY CHECK \(id = 1\)/,
  "the reliable designation is a singleton row",
);
assert.match(
  presetMigrations,
  /FOREIGN KEY \(preset_id\) REFERENCES presets\(id\) ON DELETE CASCADE/,
  "deleting the preset clears the reliable designation",
);

// Changing the override must flag live workers running under it: provider/
// model are fixed at spawn, so a worker predating the change offers Restart
// instead of a Resume that changes nothing (same contract as assignPreset).
assert.match(
  presetHandlers,
  /if \(table === "reliable_preset"\) accessors\.refreshLiveWorkers\(null\)/,
  "all live workers are re-evaluated through the shared fan-out helper",
);
assert.match(
  presetHandlers,
  /assignReliablePreset: async \(\{ presetId \}: SingletonInput\) =>\n\s*designate\("reliable_preset", presetId\)/,
  "the reliable setter names the reliable table",
);
assert.match(
  presetHandlers,
  /INSERT OR REPLACE INTO \$\{table\} \(id, preset_id, assigned_at\)/,
  "the setter upserts the singleton row",
);
assert.match(
  presetHandlers,
  /DELETE FROM \$\{table\} WHERE id = 1/,
  "clearing the override deletes the singleton row",
);
assert.match(
  presetAccessors,
  /reliableOverride: singletonPresetId\(db, "reliable_preset"\)/,
  "the resolver reads the reliable singleton",
);
assert.match(
  presetAccessors,
  /resolveReliablePreset\(/,
  "the resolver calls the lib cascade",
);

// The resolver lives beside getPresetForBand — never inside it — so the
// draft-burst band fallback keeps resolving the pure band preset.
assert.match(
  presetAccessors,
  /getReliablePresetForBand = \(band: string, cardId: string\): PresetRow =>/,
  "the reliable resolver exists beside the band resolver",
);
assert.match(
  presetAccessors,
  /getPresetForBand = \(band: string, cardId: string\): PresetRow =>/,
  "the pure band resolver still exists",
);
const reliableResolver = presetAccessors.slice(
  presetAccessors.indexOf("getReliablePresetForBand ="),
  presetAccessors.indexOf("const presetAttachmentParams"),
);
assert.ok(
  reliableResolver.includes("resolveReliablePreset({"),
  "the resolver calls the lib cascade — a body gutted to pure band delegation fails here",
);
const bandResolver = presetAccessors.slice(
  presetAccessors.indexOf("getPresetForBand ="),
  presetAccessors.indexOf("getReliablePresetForBand ="),
);
assert.ok(
  !bandResolver.includes("reliable"),
  "the pure band resolver never consults the override",
);
const draftBandFallback =
  /const band = deps\.getPresetForBand\(bandForCardKindStage\(card\.kind, card\.stage\), card\.id\);/;
assert.match(
  drafting,
  draftBandFallback,
  "the draft-burst fallback still resolves the pure band preset",
);

// Every reliable-tier spawn resolves through the override-aware resolver:
// fresh starts, promotion handoff, research fan-out, both band swaps, and
// the initial spawn chain. A spawn that bypasses it silently ignores the
// user's override.
const freshReliable =
  /const effective = deps\.getReliablePreset\(bandForCardKindStage\(card\.kind, card\.stage\), cardId\);/;
assert.match(
  workerBackend,
  freshReliable,
  "fresh starts resolve reliable-aware",
);
assert.match(
  server,
  /const effective = getReliablePresetForBand\("research", cardId\);/,
  "research fan-out resolves reliable-aware",
);
assert.match(
  server,
  /\? getReliablePresetForBand\(STAGE_TO_BAND\[card\.stage\] \?\? "analysis", cardId\)/,
  "promotion handoff resolves reliable-aware",
);
assert.match(
  executionAdvance,
  /const preset = deps\.getReliablePreset\(band, card\.id\);/,
  "the advance band swap resolves reliable-aware",
);
assert.match(
  executionAdvance,
  /const currentPresetId = card\.worker_preset_id \?\? deps\.getCardPresetId\(card\.id\);/,
  "the advance band swap honors the card pin before respawning",
);
assert.match(
  cardsCreate,
  /const reliablePreset = reliableId \? deps\.getPreset\(reliableId\) : null;/,
  "the initial spawn consults the reliable row",
);
assert.match(
  cardsCreate,
  /const base = reliablePreset \?\? bandPreset \?\? selected;/,
  "the initial spawn prefers reliable over band over default",
);

// Board and card detail show the effective preset, so the panel never
// claims the band preset while a reliable override runs the worker.
assert.match(
  server,
  /const preset = deps\.getReliablePreset\(STAGE_TO_BAND\[row\.stage\] \?\? "analysis", row\.id\);/,
  "the board list shows the effective preset",
);
assert.match(
  server,
  new RegExp(
    'const preset = getReliablePresetForBand\\(card\\.kind === \\"research\\" ' +
      '\\? \\"research\\" : card\\.kind === \\"explore\\" \\? \\"explore\\" : ' +
      'STAGE_TO_BAND\\[card\\.stage\\] \\?\\? \\"analysis\\", card\\.id\\);',
  ),
  "the card detail shows the effective preset",
);

// Manager dialog: the Reliable row is a real override select (same
// "Use band preset" empty-means-today pattern as Generation), not the
// old static "no configuration" label.
assert.doesNotMatch(
  managerBand,
  /Band preset — no configuration/,
  "the unconfigurable Reliable label is gone",
);
assert.match(
  managerBand,
  /assignReliablePreset/,
  "the Reliable row assigns through the override RPC",
);
assert.match(
  managerBand,
  /getReliablePreset/,
  "the manager loads the current reliable override",
);
// Row-scoped: the empty-means-band clear option must live on the Reliable
// row itself (between its label and the Generation row) — deleting it
// strands a set override with no way back, while the RPC-string pins above
// would still pass.
const reliableRowAt = managerBand.indexOf("✓ Reliable");
assert.ok(reliableRowAt >= 0, "the Reliable row exists");
const generationRowAt = managerBand.indexOf("⚡ Generation", reliableRowAt);
assert.ok(
  generationRowAt > reliableRowAt,
  "the Generation row follows the Reliable row",
);
const reliableRow = managerBand.slice(reliableRowAt, generationRowAt);
assert.ok(
  reliableRow.includes('emptyLabel="Use band preset"'),
  "the Reliable row offers the empty-means-band clear option",
);
assert.ok(
  reliableRow.includes("assignReliablePreset"),
  "the Reliable row wires its select to the override RPC",
);

// Mutation success and post-mutation refresh have separate failure edges.
// Otherwise a failed list refresh reports that the persisted assignment failed.
const setBandAt = managerBand.indexOf("const setBand =");
const setBandEnd = managerBand.indexOf("  const extra =", setBandAt);
const setBandHandler = managerBand.slice(setBandAt, setBandEnd);
assert.ok(
  setBandAt >= 0 && setBandEnd > setBandAt,
  "the phase assignment handler is bounded",
);
const refreshAt = setBandHandler.indexOf("void onChanged()");
const listAt = setBandHandler.indexOf('call("listBandPresets"');
assert.ok(
  refreshAt >= 0 && listAt > refreshAt,
  "a successful assignment starts the parent refresh",
);
assert.match(
  setBandHandler,
  /\.catch\(\(\) => onBandsChange\(\[\]\)\)/,
  "a failed list refresh clears stale routing without claiming the assignment failed",
);
assert.match(
  setBandHandler,
  /Failed to set phase preset\./,
  "only the mutation failure owns the phase failure message",
);

// Independent review is not a tier: one designated preset in another model
// family, read-only, and the review command refuses without it instead of
// falling back. The row lives below the tiers with its own clear option,
// so the tiers above can never be mistaken for review configuration.
const reviewerRowAt = managerBand.indexOf(
  "◎ Independent review",
  generationRowAt,
);
assert.ok(
  reviewerRowAt > generationRowAt,
  "the Review row follows the tiers, visibly separated",
);
const reviewerRow = managerBand.slice(reviewerRowAt);
assert.ok(
  reviewerRow.includes("assignReviewPreset"),
  "the Review row assigns through the reviewer RPC",
);
assert.ok(
  reviewerRow.includes('emptyLabel="No reviewer"'),
  "clearing the reviewer is explicit — empty never silently means a worker preset",
);
assert.ok(
  managerBand.includes("reviews refuse instead of ") &&
    managerBand.includes("borrowing a worker preset."),
  "the row states the refuse-instead-of-fallback contract",
);

const setDelegatedAt = managerBand.indexOf("function assignDelegatedPreset");
const setDelegatedEnd = managerBand.indexOf(
  "export function PresetManagerDelegatedWork",
  setDelegatedAt,
);
const setDelegatedHandler = managerBand.slice(setDelegatedAt, setDelegatedEnd);
assert.ok(
  setDelegatedAt >= 0 && setDelegatedEnd > setDelegatedAt,
  "the delegated assignment handler is bounded",
);
const delegatedRefreshAt = setDelegatedHandler.indexOf(
  "void actions.onChanged()",
);
const delegatedReloadAt = setDelegatedHandler.indexOf(
  'call("getReliablePreset"',
);
assert.ok(
  delegatedRefreshAt >= 0 && delegatedReloadAt > delegatedRefreshAt,
  "a successful designation starts refresh and local reload independently",
);
assert.ok(
  setDelegatedHandler.includes('call("getReviewPreset"'),
  "the manager reloads the current reviewer designation",
);
const failuresAt = managerBand.indexOf("const DELEGATED_FAILURES");
const failuresEnd = managerBand.indexOf("function PresetSelect", failuresAt);
const failureMessages = managerBand.slice(failuresAt, failuresEnd);
for (const message of [
  "Failed to set reliable preset.",
  "Failed to set generation preset.",
  "Failed to set reviewer preset.",
]) {
  const tier = message.split(" ")[3];
  assert.ok(
    failureMessages.includes(message),
    `the ${tier} failure stays action-specific`,
  );
}

console.log(
  "reliable preset test ok: cascade order, singleton discipline, spawn wiring, manager override",
);
