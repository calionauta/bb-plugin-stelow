/**
 * How the source-pin ratchet decides whether a test reads source text *as text*.
 *
 * The classification lives here rather than inline in the guard so it can be
 * tested directly: a ratchet whose counting rule is only exercised by the
 * repository it counts cannot show that its rule is right, only that its number
 * stopped moving.
 *
 * A "pin" is a test that opens a source file and asserts regexes against it.
 * Pins pass on broken logic (they match prose) and break on refactors (a rename
 * fails the suite while the product works), so the ratchet counts them and only
 * ever lets the count fall.
 */

export const ENTRYPOINT_PATTERN = /(server\.ts|app\.tsx)/;

export const SOURCE_PATTERN = /(server\.ts|app\.tsx|server\/|components\/|hooks\/|lib\/)/;

// Fixture/data reads are outside the count by construction: state.md fixtures,
// package.json, skills mirrors, data snapshots, binary assets. Only a
// source-text read counts.
export const FIXTURE_PATTERN = /(\.state\.md|package\.json|skills\/|data\/|stelow\.json|\.png|\.jpg|\.svg|tests\/fixtures)/;

// A test that discovers files with `readdirSync` and then reads each one by
// variable carries no literal inside the readFileSync window, so the directory
// it walks is the only signal available. That signal must name a SOURCE
// directory: walking `skills/`, `data/` or a dependency bundle is a fixture
// read and belongs outside the count, which is the whole reason this pattern is
// narrower than SOURCE_PATTERN. Matching SOURCE_PATTERN against the whole file
// text counted any test that merely mentioned `lib/` in an import while reading
// skills fixtures.
export const SOURCE_DIRECTORY_PATTERN = /["'`](?:server|components|hooks|lib)(?:\/|["'`])/;

/** Every `readFileSync(...)` call, as a balanced-paren slice of one window. */
export function readCallWindows(text) {
  const windows = [];
  let from = 0;
  while (true) {
    const at = text.indexOf("readFileSync(", from);
    if (at < 0) break;
    // Balanced-paren slice so multiline join()/URL forms stay inside one window.
    let depth = 0;
    let end = at;
    for (; end < text.length && end < at + 4000; end++) {
      if (text[end] === "(") depth++;
      else if (text[end] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    windows.push(text.slice(at, Math.min(end + 1, at + 4000)));
    from = at + 1;
  }
  return windows;
}

/**
 * Classify one test file's text.
 *
 * `sourcePin` is the number the ratchet counts. `dynamicDirPin` names the case
 * that made the rule subtle, so a failure can say which half fired.
 */
export function classifySourcePin(text) {
  const windows = readCallWindows(text).filter((window) => !FIXTURE_PATTERN.test(window));
  if (windows.length === 0) return { sourcePin: false, entrypointPin: false, windows: 0, dynamicDirPin: false };
  const entrypointPin = windows.some((window) => ENTRYPOINT_PATTERN.test(window));
  const literalSourcePin = windows.some((window) => SOURCE_PATTERN.test(window));
  const dynamicDirPin = /readdirSync/.test(text) && SOURCE_DIRECTORY_PATTERN.test(text);
  return { sourcePin: literalSourcePin || dynamicDirPin, entrypointPin, windows: windows.length, dynamicDirPin };
}
