import assert from "node:assert/strict";
import { buildCard, callsNamed, cliHarness } from "./helpers/cli-harness.mjs";

// One owner for "which artifacts this card produced": the `artifacts:` list in
// `state.md`, as read by `parseArtifactManifest`. Every number a surface shows
// is derived from it — `bb stelow manifest` always was, the run-bundle trailer
// was not (it counted the files the exporter managed to copy).
//
// That disagreement is durable damage: a finished card's commit carried
// `Stelow-Artifacts: 0` while the bundle's own `## Missing` section listed
// seventeen registered artifacts and `state.md` named more. A reader a year
// from now has the commit, not the workspace, so the commit is where the lie
// lasts. This test holds the two derivations together and mutates the owner to
// prove they both move with it.
const STATE = "/w/.stelow/state/state.md";

const artifact = (stage, path) => [
  `  - stage: ${stage}`,
  "    kind: document",
  `    path: ${path}`,
];

const stateBlob = (entries, extra = []) => [
  "---",
  "name: workflow",
  "artifacts:",
  ...entries.flat(),
  ...extra,
  "---",
  "",
].join("\n");

/** The trailer's count, read the way a reader of the commit reads it. */
function trailerCount(stdout) {
  const match = /^Stelow-Artifacts: (\d+)$/m.exec(stdout);
  assert.ok(match, `the output carries a Stelow-Artifacts trailer: ${stdout}`);
  return Number(match[1]);
}

/** One card: three registered artifacts, two of which can be read. The
 * unreadable one is the whole point — it was produced, so it counts. */
async function projectWith(entries, files) {
  const harness = cliHarness({
    card: buildCard({ kind: "research" }),
    files: { [STATE]: stateBlob(entries), ...files },
  });
  const manifest = await harness.invoke(["manifest"]);
  const exported = await harness.invoke(["export"]);
  assert.equal(manifest.exitCode, 0, `manifest exits 0: ${manifest.stderr}`);
  assert.equal(exported.exitCode, 0, `export exits 0: ${exported.stderr}`);
  return { harness, manifest, exported };
}

const readable = { "/w/audit.md": "# Audit\n\nBody\n", "/w/plans/spec-tech.md": "# Tech plan\n" };
const threeArtifacts = [
  artifact("audit", "audit.md"),
  artifact("plan", "plans/spec-tech.md"),
  artifact("execution", "plans/verification-unreadable.md"),
];
const { harness, manifest, exported } = await projectWith(threeArtifacts, readable);

// 1. The committed trailer, the CLI manifest, and the bundle's own embedded
//    trailer are one number, and it is the owner's.
const bundleManifest = callsNamed(harness.calls, "write")
  .map(([, payload]) => payload)
  .find((payload) => String(payload.path).endsWith("/manifest.md"));
assert.ok(bundleManifest, "export writes the run-bundle manifest.md");
assert.equal(trailerCount(manifest.stdout), 3, "`bb stelow manifest` counts what state.md registers");
assert.equal(trailerCount(exported.stdout), 3, "the export trailer counts what state.md registers");
assert.equal(
  trailerCount(String(bundleManifest.content)),
  3,
  "the trailer embedded in docs/runs/<card>/manifest.md counts what state.md registers",
);
assert.ok(
  String(bundleManifest.content).includes("(2 copied)"),
  "while the manifest still says how many of them this export actually copied — two different facts, each named",
);
assert.ok(
  String(bundleManifest.content).includes("plans/verification-unreadable.md"),
  "the artifact it could not read is listed as missing, never dropped from the record",
);

// 2. Red proof: remove one artifact from the owner and BOTH derived numbers
//    drop by exactly one. A number that does not move is not derived from it.
const { manifest: smallerManifest, exported: smallerExport } = await projectWith(threeArtifacts.slice(0, 2), readable);
assert.equal(
  trailerCount(manifest.stdout) - trailerCount(smallerManifest.stdout),
  1,
  "removing one artifact from state.md drops the manifest count by exactly one",
);
assert.equal(
  trailerCount(exported.stdout) - trailerCount(smallerExport.stdout),
  1,
  "removing one artifact from state.md drops the bundle trailer by exactly one",
);

// 3. The delta between "rows written in state.md" and "artifacts registered"
//    is named, not silently absorbed: a repeated path is one artifact, and a
//    row with no path names nothing this host can read or copy. Declared rows
//    are not a second count — they are malformed input to the one owner.
const declared = [
  artifact("audit", "audit.md"),
  artifact("audit", "audit.md"),
  artifact("plan", "plans/spec-tech.md"),
];
const pathless = ["  - stage: execution", "    kind: document", "    label: unnamed"];
const { manifest: noisyManifest } = await projectWith([...declared, pathless], readable);
assert.equal(
  trailerCount(noisyManifest.stdout),
  2,
  "4 declared rows naming 2 artifacts count as 2: one duplicate path and one row without a path are not artifacts",
);

console.log("artifact count owner test ok: trailer and manifest derive from state.md, and both move with it");
