/**
 * A floor on how many `test:*` bands package.json declares.
 *
 * `tests/suite-wiring.test.mjs` proves every test FILE is mentioned by some
 * script. It does not prove that script still runs: when a branch's older
 * package.json wins a merge, every band the target branch added since the fork
 * disappears, while each vanished band's files are still mentioned by a band
 * that survived — so wiring stays green and six bands quietly stop running.
 * That is the lie a green PR told in #420: master declared 88 `test:` scripts,
 * the branch 87, and the branch side of the conflict cost `test:contrast-wiring`
 * while `suite-wiring` had nothing to say about it.
 *
 * The floor only rises. Adding a band: raise `TEST_SCRIPT_FLOOR` in the same
 * commit. Removing one is removing CI coverage — if that is really intended,
 * the commit says why and the floor moves down there, deliberately, rather
 * than being lowered to match whatever a bad merge left behind.
 */

/** The recorded floor. Count `"test:` keys in package.json when raising it. */
export const TEST_SCRIPT_FLOOR = 90;

/** Band names only: `test` itself is the aggregate, not a band. */
export function testScriptNames(scripts) {
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    throw new Error("test script floor: package.json scripts must be an object");
  }
  return Object.keys(scripts).filter((name) => name.startsWith("test:"));
}

/**
 * Refuse a package.json whose band count fell under the recorded floor, naming
 * both numbers so the diff that dropped a band is the next thing read.
 */
export function assertTestScriptFloor(scripts, floor = TEST_SCRIPT_FLOOR) {
  const names = testScriptNames(scripts);
  if (names.length < floor) {
    const missing = floor - names.length;
    throw new Error(
      `package.json declares ${names.length} "test:" scripts, below the recorded floor of ${floor} — ${missing} CI band(s) went missing. ` +
        "Resolve package.json against the branch you are merging into and re-add the new test references; never lower the floor to match a bad merge.",
    );
  }
  return { count: names.length, floor };
}
