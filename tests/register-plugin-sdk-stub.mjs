/**
 * Resolve `@get-bb/plugin-sdk/app` to the local host stub so a plugin component
 * can be rendered outside bb. See helpers/plugin-sdk-app-stub.mjs for why the
 * boundary is stubbed and the components under test are not.
 */
import { register } from "node:module";
import { isMainThread } from "node:worker_threads";
import { pathToFileURL } from "node:url";

if (isMainThread) register(import.meta.filename, pathToFileURL("./"));

const STUB_URL = new URL("./helpers/plugin-sdk-app-stub.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@get-bb/plugin-sdk/app") {
    return { url: STUB_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
