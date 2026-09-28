/**
 * The guard is an adapter around a pure decision, so both halves are pinned.
 *
 * The decision is covered in release-published.test.mjs. What this file covers
 * is the wiring: that the script reads the published release from GitHub rather
 * than from the local clone, and that it exits non-zero on the stranded state.
 *
 * That second point is not hypothetical bookkeeping. The first version of this
 * script read tags from the clone, which is checked out before release-please
 * runs — so it could not see the tag the action had just pushed. It fired on
 * v0.57.1 seconds after v0.57.1 was published and would have blocked a
 * legitimate release. The shims below reproduce that boundary: the clone
 * reports an older tag than GitHub does, and the GitHub value must win.
 *
 * `gh` and `git` are shimmed through PATH, so the script runs exactly as CI
 * runs it and the seam being tested is the real one.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const script = join(root, "scripts", "check-release-published.mjs");

/** A throwaway checkout with a chosen version, plus gh/git shims. */
function fixture({ version, githubTags, localTags, openPrTitles }) {
  const dir = mkdtempSync(join(tmpdir(), "release-published-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "lib"), { recursive: true });
  mkdirSync(join(dir, "bin"), { recursive: true });

  for (const name of ["check-release-published.mjs"]) {
    writeFileSync(join(dir, "scripts", name), readFileSync(join(root, "scripts", name)));
  }
  for (const name of ["github-release.mjs", "release-published.mjs"]) {
    writeFileSync(join(dir, "lib", name), readFileSync(join(root, "lib", name)));
  }
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version }, null, 2));

  const shim = (name, body) => {
    const file = join(dir, "bin", name);
    writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(file, 0o755);
  };

  shim(
    "git",
    [
      'if [ "$1" = "remote" ]; then echo "https://github.com/calionauta/bb-plugin-stelow.git"; exit 0; fi',
      `echo ${JSON.stringify(localTags.join("\n"))}`,
    ].join("\n"),
  );
  // Strict on purpose: the shim answers only the exact releases query the
  // script is supposed to make, and fails anything else. A shim that ignored
  // its arguments would let a change to the query pass unnoticed, which is
  // exactly the seam this file exists to test.
  shim(
    "gh",
    [
      'case "$*" in',
      `  *repos/calionauta/bb-plugin-stelow/releases*) echo ${JSON.stringify(githubTags.join("\n"))} ;;`,
      "  *pr\\ list*) echo " + JSON.stringify(openPrTitles.join("\n")) + " ;;",
      "  *) exit 1 ;;",
      "esac",
    ].join("\n"),
  );

  return spawnSync(process.execPath, [join(dir, "scripts", "check-release-published.mjs")], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}` },
  });
}

// The regression: GitHub has already published the tag, the clone has not seen
// it yet. Trusting the clone would report a healthy release as stranded.
const raced = fixture({ version: "0.57.1", githubTags: ["v0.57.1"], localTags: ["v0.57.0"], openPrTitles: [] });
assert.equal(raced.status, 0, "a release published seconds ago is not reported as stranded");
assert.match(raced.stdout, /released/, "the GitHub tag wins over the stale clone");
assert.match(raced.stdout, /GitHub releases/, "the log says where the tag came from");

// The stranded state: master bumped, nothing published, nothing open.
const stranded = fixture({ version: "0.57.0", githubTags: ["v0.56.4"], localTags: ["v0.56.4"], openPrTitles: [] });
assert.equal(stranded.status, 1, "a merged bump with no published release fails the run");
assert.match(stranded.stdout, /unpublished/, "the state is named");
assert.match(stranded.stderr, /::error::/, "the failure carries a CI annotation");
assert.match(stranded.stderr, /0\.57\.0/, "the annotation names the stranded version");

// A bump in flight is not a failure.
const pending = fixture({
  version: "0.58.0",
  githubTags: ["v0.57.1"],
  localTags: ["v0.57.1"],
  openPrTitles: ["chore(master): release 0.58.0"],
});
assert.equal(pending.status, 0, "an open release PR accounts for the bump");

// An ordinary feature push: master still at the published version.
const ordinary = fixture({ version: "0.57.1", githubTags: ["v0.57.1"], localTags: ["v0.57.1"], openPrTitles: [] });
assert.equal(ordinary.status, 0, "an ordinary push stays green");

// No `gh` at all falls back to the clone's tags rather than crashing.
const dir = mkdtempSync(join(tmpdir(), "release-published-nogh-"));
mkdirSync(join(dir, "scripts"), { recursive: true });
mkdirSync(join(dir, "lib"), { recursive: true });
writeFileSync(join(dir, "scripts", "check-release-published.mjs"), readFileSync(script));
for (const name of ["github-release.mjs", "release-published.mjs"]) {
  writeFileSync(join(dir, "lib", name), readFileSync(join(root, "lib", name)));
}
writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "0.57.1" }, null, 2));
const emptyBin = mkdtempSync(join(tmpdir(), "release-published-bin-"));
const gitOnly = join(emptyBin, "git");
writeFileSync(
  gitOnly,
  [
    "#!/usr/bin/env bash",
    'if [ "$1" = "remote" ]; then',
    '  echo "https://github.com/calionauta/bb-plugin-stelow.git"',
    "  exit 0",
    "fi",
    "echo v0.57.1",
    "",
  ].join("\n"),
);
chmodSync(gitOnly, 0o755);
const noGh = spawnSync(process.execPath, [join(dir, "scripts", "check-release-published.mjs")], {
  encoding: "utf8",
  env: { PATH: emptyBin, HOME: dir },
});
assert.equal(noGh.status, 0, "without gh the guard falls back to local tags instead of failing the release");
assert.match(noGh.stdout, /skipped|released/, "the fallback is reported, not silent");

console.log("release-published script ok: reads the published release, and a stranded bump exits 1");
