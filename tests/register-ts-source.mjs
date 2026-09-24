import { access } from "node:fs/promises";
import { isMainThread } from "node:worker_threads";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

if (isMainThread) register(import.meta.filename, pathToFileURL("./"));

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL ?? "";
  if ((parent.includes("/server/") || parent.endsWith("/server.ts")) && specifier.startsWith(".") && specifier.endsWith(".js")) {
    const candidate = new URL(`${specifier.slice(0, -3)}.ts`, parent);
    try {
      await access(fileURLToPath(candidate));
      return { url: candidate.href, shortCircuit: true };
    } catch {
      // Existing .js imports still resolve normally.
    }
  }
  return nextResolve(specifier, context);
}
