/**
 * Source with comments stripped.
 *
 * A test that reads a source file to check what the CODE says has to be able to
 * tell code from prose, or it will fail the moment someone explains the change
 * they just made. That is not hypothetical: three separate test files here
 * asserted over raw source, and each one went red the first time a fix
 * documented itself — `execution-reconcile-run.ts` still contains the string
 * `unknown-native-state`, in a comment saying what it used to write.
 *
 * A test that cannot tell documentation from code gets worked around, and the
 * workaround is deleting the explanation. That is the expensive direction: the
 * next reader loses the reason and the fix looks arbitrary.
 *
 * Block comments are handled by the line prefix, which covers the
 * slash-star-star style this repo uses. A trailing comment on a line of code
 * stays, because that IS code-adjacent and pinning it is usually the intent.
 * (Naming that delimiter inside its own docstring closes the comment early —
 * worth knowing the hard way once.)
 */
export function codeOf(source) {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

/** `codeOf` over a file's lines, for tests that report offenders per line. */
export function codeLinesOf(source) {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    });
}
