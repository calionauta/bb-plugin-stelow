import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const POSTBUILD = new URL("../scripts/postbuild.mjs", import.meta.url).pathname;

function fixture({ withFreeze }) {
  const root = mkdtempSync(join(tmpdir(), "postbuild-"));
  mkdirSync(join(root, "dist", "skills"), { recursive: true });
  mkdirSync(join(root, "skills"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: "test" }));
  writeFileSync(
    join(root, "skills", "doc.md"),
    // NOTE: the marker must contain the literal substring "freeze"
    // ("freeze_sha" matches; "frozen_sha" does not).
    withFreeze ? "freeze_sha: abc123\n" : "no marker here\n",
  );
  return root;
}

function run(root) {
  // console.warn goes to stderr, so both streams are captured.
  const res = spawnSync("node", [POSTBUILD], { cwd: root, encoding: "utf8" });
  return { exit: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

test("postbuild proves the shipped mirror carries the freeze marker", () => {
  const out = run(fixture({ withFreeze: true }));
  assert.equal(out.exit, 0);
  assert.match(out.stdout, /freeze mirror ok \(1 files\)/, "shipped dist/skills proves the freeze reached users");
});

test("postbuild without a freeze marker warns but stays green (not yet frozen upstream)", () => {
  const out = run(fixture({ withFreeze: false }));
  assert.equal(out.exit, 0, "missing marker is warn-only, never a broken build");
  assert.match(out.stderr, /no freeze marker yet/, "the warn names the cause on stderr");
});
