import assert from "node:assert/strict";
import { splitDiffByFile, MAX_DIFF_FILES } from "../lib/diff-split.mjs";

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
-old a
+new a
diff --git a/src/b.ts b/src/b.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/b.ts
@@ -0,0 +1 @@
+hello
diff --git a/old.ts b/new.ts
similarity index 90%
rename from old.ts
rename to new.ts
index 4444444..5555555 100644
--- a/old.ts
+++ b/new.ts
@@ -1 +1 @@
-same
+same
`;

// Multi-file split: b/ side wins (post-image, correct for renames).
{
  const { files, truncated } = splitDiffByFile(PATCH);
  assert.equal(truncated, false);
  assert.deepEqual(files.map((f) => f.path), ["src/a.ts", "src/b.ts", "new.ts"]);
  assert.ok(files[0].patch.includes("-old a"), "hunk bodies follow their file");
  assert.ok(files.every((f) => !f.truncated), "small patches intact");
}

// Garbage and empties yield zero files, never throw.
assert.deepEqual(splitDiffByFile(""), { files: [], truncated: false }, "empty diff");
assert.deepEqual(splitDiffByFile("not a diff\nat all"), { files: [], truncated: false }, "prose yields nothing");
assert.deepEqual(splitDiffByFile(null), { files: [], truncated: false }, "null yields nothing");

// Bounds: file count caps with truncated=true; bodies cap per file.
{
  const many = Array.from({ length: MAX_DIFF_FILES + 5 }, (_, i) => `diff --git a/f${i}.ts b/f${i}.ts\n+x`).join("\n");
  const capped = splitDiffByFile(many);
  assert.equal(capped.files.length, MAX_DIFF_FILES, "file count capped");
  assert.equal(capped.truncated, true, "cap reported");
  const big = `diff --git a/big.ts b/big.ts\n` + "x".repeat(60000);
  const [only] = splitDiffByFile(big).files;
  assert.ok(only.patch.length <= 50000 && only.truncated, "body capped and flagged");
}

console.log("diff split test ok: per-file split, renames, bounds, garbage");
