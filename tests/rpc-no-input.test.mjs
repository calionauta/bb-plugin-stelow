import assert from "node:assert/strict";
import test from "node:test";
import { rpcContract } from "../server/rpc-contract.ts";

/**
 * A caller with nothing to say sends nothing, and the host sends `null`.
 *
 * The SDK types a method's call args as optional exactly when its input schema
 * accepts null, so `z.object({})` on a zero-argument method is a shaped-input
 * bug: the UI works because it always passes an object, while any caller that
 * omits the argument — the CLI, a probe, `bb plugin list` — fails validation on
 * a method that has nothing to validate.
 *
 * One invariant covers the whole class: a method that accepts `{}` must also
 * accept an omitted argument, and both must parse to the same value so field
 * defaults still apply.
 */

test("a method that accepts {} also accepts a caller that sent nothing", () => {
  const noArg = [];
  const offenders = [];
  for (const [name, method] of Object.entries(rpcContract)) {
    const empty = method.input.safeParse({});
    if (!empty.success) continue; // needs fields: an object is genuinely required
    noArg.push(name);
    const omitted = method.input.safeParse(null);
    if (!omitted.success) {
      offenders.push(name);
      continue;
    }
    assert.deepEqual(
      omitted.value,
      empty.value,
      `${name}: an omitted argument must mean the empty object, defaults included`,
    );
  }
  assert.deepEqual(
    offenders,
    [],
    "these methods accept {} but reject an omitted argument (null) — declare the input with optionalInput",
  );
  // Without this the invariant passes vacuously if every no-arg method ever
  // grows a required field.
  assert.ok(noArg.length >= 20, `the no-argument surface should be broad, saw ${noArg.length}`);
});

test("an omitted argument still cannot smuggle a field past a strict schema", () => {
  const strict = Object.entries(rpcContract).filter(([, method]) => method.input.safeParse({}).success);
  for (const [name, method] of strict) {
    assert.equal(
      method.input.safeParse({ unknownField: true }).success,
      false,
      `${name} must stay strict about fields it does not declare`,
    );
  }
});
