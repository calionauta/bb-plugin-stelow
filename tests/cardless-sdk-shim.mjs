import { register } from "node:module";
import { isMainThread } from "node:worker_threads";
import { pathToFileURL } from "node:url";

// Test-only stand-in for `@get-bb/plugin-sdk`.
//
// The server imports the SDK type-only (`import { type BbPluginApi }`), so no
// runtime binding is ever read from it — but Node's `--experimental-strip-types`
// still resolves the specifier, and this environment has no `node_modules` for
// it to resolve against. Verified: importing
// `../server/runtime/workflow-state.ts` (or anything reaching it, e.g.
// `../server/execution-advance-cli.ts` via `./runtime/workflow-state.js`)
// fails with `ERR_MODULE_NOT_FOUND: Cannot find package '@get-bb/plugin-sdk'`
// before any test code runs. CI installs devDependencies, so the same tests
// load there with zero behavior change: the stub only answers resolution, and
// the type-only import is erased before linking (an empty module suffices).
//
// Import this module for its side effect BEFORE dynamically importing any
// server `.ts` under test. Static `.ts` imports cannot be used: they resolve
// at load time, before this hook is registered.
if (isMainThread) register(import.meta.filename, pathToFileURL("./"));

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@get-bb/plugin-sdk") {
    return { url: import.meta.url, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
