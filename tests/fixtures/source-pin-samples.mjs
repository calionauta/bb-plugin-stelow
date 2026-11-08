/**
 * Synthetic test sources for source-pin-classify.test.mjs.
 *
 * They live in a fixture rather than in the test file on purpose: the ratchet
 * scans `tests/*.test.mjs` as text, so a sample embedding `readFileSync("…")`
 * inside a template literal would make the sample's own file look like a pin.
 * A fixture under tests/fixtures/ is outside that scan, and the read windows a
 * test uses to load it carry the fixture path, which the ratchet ignores by
 * construction.
 */

const READ = "readFileSync";
const DIR = "readdirSync";

/** A literal read of one named path. */
export const literalRead = (path) => `const text = ${READ}(${JSON.stringify(path)}, "utf8");`;

/** A walk that discovers files and reads each by variable — no literal in the call. */
export const discoveredRead = (directory) => [
  `import { helper } from "../lib/helpers.mjs";`,
  `const walk = (dir) => ${DIR}(dir).flatMap((entry) => ${READ}(join(dir, entry), "utf8"));`,
  `const all = walk(join(root, ${JSON.stringify(directory)}));`,
  `helper(all);`,
].join("\n");

/** A read of the composition entrypoint. */
export const entrypointRead = () => `const text = ${READ}(new URL("../server.ts", import.meta.url), "utf8");`;

/** A file that reads nothing at all. */
export const noReads = "import x from \"./y.mjs\";";

/**
 * A file that only DESCRIBES the discovered-directory rule.
 *
 * The classifier's own test sat in the census for six weeks because its
 * docstring explains "a walk that discovers files with `readdirSync`". A rule
 * that counts prose about itself is a rule that cannot be documented, so the
 * samples live here — the ratchet scans `tests/*.test.mjs` as text, and this
 * fixture is outside that scan by construction.
 */
export const proseAboutTheRule = () => [
  "// a walk that discovers files with readdirSync and reads ../lib/ by variable",
  "/* readdirSync over components/ is the subtle half */",
  "export const nothing = 1;",
].join("\n");

/** The same signal, in code: comment stripping must not blind the rule. */
export const walkInCode = () => [
  `const files = ${DIR}(${JSON.stringify("components")});`,
  `for (const f of files) { const text = ${READ}(f, "utf8"); }`,
].join("\n");
