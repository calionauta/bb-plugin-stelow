/**
 * The plugin's JTBD enforcement must stay a projection of stelow's contract.
 *
 * The bug this catches: stelow renames a substep or a reference file, adds a new
 * one, and this host keeps judging against the old list. Nothing throws — review
 * just gets quietly wrong, one artifact at a time, until someone notices.
 *
 * It also refuses the other direction. A substep may ship without a mechanical
 * check only through NO_MECHANICAL_CONTRACT, which names a reason; adding a
 * substep to that table is a recorded debt instead of an invisible hole, and an
 * entry that no longer matches upstream fails as stale.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { JTBD_CONTRACTS, JTBD_SUBSTEPS, contractForSubstep } from "../lib/jtbd-contracts.mjs";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VENDORED = join(PLUGIN, "lib", "stelow-jtbd-contracts.mjs");

/**
 * Substeps stelow declares that this host enforces with no mechanical check.
 * Empty today: every declared substep has a contract. An entry here is a
 * recorded debt, and it fails as stale the moment the contract catches up.
 */
const NO_MECHANICAL_CONTRACT = {};

// The vendored file must be generated, and it must say from where. A hand-edited
// copy is how the two repos drifted apart the first time.
const vendored = readFileSync(VENDORED, "utf8");
const stamp = vendored.match(/Source: stelow ([0-9a-f]{12})/);
assert.ok(stamp, "lib/stelow-jtbd-contracts.mjs carries no stelow commit stamp — regenerate it, do not edit it");

// A translation pass checked by accent only leaves `Mesmo ator`, `Etapa` and
// `Nenhum` behind, and those reach this host as data (stelow 0.88.1).
const portuguese = /\b(mesmo|não|são|você|também|então|etapa|etapas|usuário|nenhum|nenhuma|evidência|pesquisa|inferência|sobre|deve ser|pode ser)\b/i;
const leftover = JSON.stringify(JTBD_SUBSTEPS).match(portuguese);
assert.equal(
  leftover,
  null,
  `the vendored stelow contract still carries Portuguese: ${leftover && leftover[0]} — rerun scripts/sync-jtbd-contracts.mjs against a translated stelow`,
);

const upstream = JTBD_SUBSTEPS.map((substep) => substep.slug);
assert.ok(upstream.length > 0, "the vendored contract lists no substeps");
assert.equal(
  new Set(upstream).size,
  upstream.length,
  `the vendored contract repeats a substep slug: ${upstream.join(", ")}`,
);

// Upstream order is the sequence the methodology prescribes; the plugin must not
// quietly reorder it, because substeps feed each other.
const enforcedOrder = JTBD_CONTRACTS.map((contract) => contract.slug).filter((slug) => upstream.includes(slug));
assert.deepEqual(
  enforcedOrder,
  upstream.filter((slug) => enforcedOrder.includes(slug)),
  "JTBD_CONTRACTS is out of stelow's substep order",
);

for (const contract of JTBD_CONTRACTS) {
  assert.ok(
    upstream.includes(contract.slug),
    `lib/jtbd-contracts.mjs enforces '${contract.slug}', which stelow no longer declares — rerun scripts/sync-jtbd-contracts.mjs`,
  );
  assert.ok(
    Array.isArray(contract.checks) && contract.checks.length > 0,
    `'${contract.slug}' declares no check; give it one or move it to NO_MECHANICAL_CONTRACT with a reason`,
  );
  assert.ok(
    existsSync(join(PLUGIN, contract.ref)),
    `'${contract.slug}' points at ${contract.ref}, which does not exist in this checkout`,
  );
}

for (const slug of upstream) {
  const enforced = JTBD_CONTRACTS.some((contract) => contract.slug === slug);
  assert.ok(
    enforced || slug in NO_MECHANICAL_CONTRACT,
    `stelow declares substep '${slug}' and this host neither enforces it nor records why — add a contract or a NO_MECHANICAL_CONTRACT reason`,
  );
}

for (const slug of Object.keys(NO_MECHANICAL_CONTRACT)) {
  assert.ok(
    upstream.includes(slug),
    `NO_MECHANICAL_CONTRACT exempts '${slug}', which stelow no longer declares — delete the stale exemption`,
  );
  assert.ok(
    !JTBD_CONTRACTS.some((contract) => contract.slug === slug),
    `NO_MECHANICAL_CONTRACT exempts '${slug}' while a contract for it exists — delete the exemption`,
  );
  assert.ok(NO_MECHANICAL_CONTRACT[slug].length > 20, `the exemption for '${slug}' needs a real reason, not a placeholder`);
}

// The reference path is derived, so this fails the moment derivation breaks
// (a renamed file, a missing slug) rather than judging an artifact against "".
const actors = contractForSubstep("job-actors");
assert.ok(actors, "contractForSubstep('job-actors') resolved nothing");
assert.match(actors.ref, /^skills\/stelow-product-job-to-be-done\/references\/05-job-actors\.md$/);
assert.equal(contractForSubstep("no-such-substep"), null, "an unknown substep must resolve to null, not throw");

const enforced = JTBD_CONTRACTS.length;
const exempt = Object.keys(NO_MECHANICAL_CONTRACT).length;
console.log(
  `jtbd-contract-coverage: ${enforced} substeps enforced, ${exempt} exempt with a reason, ` +
    `${upstream.length} declared upstream, vendored from stelow ${stamp[1]}`,
);
