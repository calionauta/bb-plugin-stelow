import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePinnedRevision } from "../lib/workflow-skills-sync.mjs";

// The pin is two files that must name the same revision, and the failure mode
// is silent: the sync workflow used to rewrite them by hand in YAML, so a run
// that moved one and not the other failed `tests/upstream-hygiene` and opened
// no PR. Syncs stopped landing and the pin sat four releases behind while the
// cron reported failure once a day. One writer, both files.
//
// The ledger is host POLICY, not upstream content: only `pin` and
// `upstream_version` move, and an unreadable ledger is refused rather than
// replaced — a merge conflict in a fork's reason must not be "fixed" by
// deleting the fork.

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const OLD_COMMIT = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "stelow-pin-"));
  mkdirSync(join(root, "data"), { recursive: true });
  writeFileSync(
    join(root, "data", "stelow-source.json"),
    `${JSON.stringify({ version: "0.1.0-alpha", commit: OLD_COMMIT }, null, 2)}\n`,
  );
  writeFileSync(
    join(root, "data", "upstream-forks.json"),
    `${JSON.stringify(
      {
        $comment: "host policy",
        pin: OLD_COMMIT,
        upstream_version: "0.1.0-alpha",
        forks: [{ area: "fail-open", reason: "host policy", status: "standing-divergence" }],
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

function read(root, name) {
  return JSON.parse(readFileSync(join(root, "data", name), "utf8"));
}

{
  const root = fixture();
  try {
    writePinnedRevision(root, { version: "0.80.0-alpha", commit: COMMIT });
    assert.deepEqual(read(root, "stelow-source.json"), { version: "0.80.0-alpha", commit: COMMIT });
    const ledger = read(root, "upstream-forks.json");
    assert.equal(ledger.pin, COMMIT, "the ledger moves with the source pin");
    assert.equal(ledger.upstream_version, "0.80.0-alpha", "the ledger names the same version");
    assert.equal(ledger.$comment, "host policy", "the ledger's explanation survives");
    assert.deepEqual(ledger.forks, [{ area: "fail-open", reason: "host policy", status: "standing-divergence" }], "forks are untouched");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  // A fresh checkout without a ledger still gets a coherent pin.
  const root = mkdtempSync(join(tmpdir(), "stelow-pin-"));
  try {
    mkdirSync(join(root, "data"), { recursive: true });
    writePinnedRevision(root, { version: "0.81.0-alpha", commit: COMMIT });
    assert.deepEqual(read(root, "upstream-forks.json"), { pin: COMMIT, upstream_version: "0.81.0-alpha", forks: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  // A malformed pin is refused BEFORE anything is written: a half-written pin
  // is worse than a stale one, because the next sync reads it.
  const root = fixture();
  const before = read(root, "stelow-source.json");
  try {
    assert.throws(() => writePinnedRevision(root, { version: "0.80.0", commit: "abc" }), /invalid pin commit/);
    assert.throws(() => writePinnedRevision(root, { version: "not a version", commit: COMMIT }), /invalid pin version/);
    assert.deepEqual(read(root, "stelow-source.json"), before, "a rejected pin leaves the previous pin intact");
    assert.equal(read(root, "upstream-forks.json").pin, OLD_COMMIT, "and the ledger too");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  // A ledger that cannot be read is a conflict or a corruption; replacing it
  // would silently drop host policy.
  const root = fixture();
  try {
    writeFileSync(join(root, "data", "upstream-forks.json"), "{ not json");
    assert.throws(
      () => writePinnedRevision(root, { version: "0.80.0-alpha", commit: COMMIT }),
      /cannot update data\/upstream-forks\.json/,
    );
    assert.equal(readFileSync(join(root, "data", "upstream-forks.json"), "utf8"), "{ not json", "the unreadable ledger is left as found");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log("stelow pin test ok: one writer keeps the source pin and the fork ledger on the same revision");
