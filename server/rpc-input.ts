import { z } from "zod";

/**
 * The input schema of an RPC that a caller may invoke without an argument.
 *
 * A caller with nothing to say sends `null`, and the SDK types a method's call
 * args as optional exactly when its input schema accepts null
 * (`PluginRpcCallArgs`: `null extends InferInput ? [input?: ...] : [input: ...]`).
 * A bare `z.object({}).strict()` refuses that null, so a zero-argument method
 * fails validation for every caller that omits the argument — the failure is a
 * shaped-input bug, not a domain refusal, and it is invisible in the UI because
 * the app always passes an object.
 *
 * Preprocessing null (and undefined) to `{}` keeps the schema strict for real
 * callers while making "no input" mean "the empty object". Field defaults then
 * apply exactly as they do for `{}`.
 */
export function optionalInput<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => value ?? {}, schema);
}

/** The input of an RPC that takes no fields at all. */
export const NO_INPUT = optionalInput(z.object({}).strict());
