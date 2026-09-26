import { access } from "node:fs/promises";
import { extname } from "node:path";
import { isMainThread } from "node:worker_threads";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

if (isMainThread) register(import.meta.filename, pathToFileURL("./"));

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL ?? "";
  const resolvesLocalServerSource = parent.endsWith("/server.ts") || parent.includes("/server/");
  if (resolvesLocalServerSource && specifier.startsWith(".") && specifier.endsWith(".js")) {
    const candidate = new URL(`${specifier.slice(0, -3)}.ts`, parent);
    try {
      await access(fileURLToPath(candidate));
      return { url: candidate.href, shortCircuit: true };
    } catch {
      // Existing .js imports still resolve normally.
    }
  }
  // The tree writes owned imports without an extension, so a test that loads a
  // rule module directly has to resolve them the way the bundler does. Without
  // this the only executable tests available for `components/` are text pins,
  // which pass on broken logic and break on refactors.
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const withoutExtension = extname(specifier) ? null : specifier;
    for (const suffix of withoutExtension ? [".ts", ".tsx", ".mjs"] : []) {
      const candidate = new URL(`${specifier}${suffix}`, parent);
      try {
        await access(fileURLToPath(candidate));
        return { url: candidate.href, shortCircuit: true };
      } catch {
        // Try the next extension.
      }
    }
  }
  return nextResolve(specifier, context);
}
