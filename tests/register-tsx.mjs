/**
 * Loads the plugin's components so a test can RENDER them, not just read them.
 *
 * `register-ts-source.mjs` next door resolves rule modules and lets Node strip
 * types. That cannot cover a component: Node's type stripping does not
 * transform JSX, and the P2 audit was "Codebase mode only" for exactly that
 * reason — every component test read the .tsx as text, so a green suite was a
 * statement about a string.
 *
 * esbuild is not a dependency. `typescript` is, so the transform uses the
 * compiler the repo already installs rather than adding a toolchain.
 */
import { access, readFile } from "node:fs/promises";
import { isMainThread } from "node:worker_threads";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (isMainThread) register(import.meta.filename, pathToFileURL("./"));

const COMPILER_OPTIONS = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX,
  esModuleInterop: true,
};

async function firstExisting(base, suffixes) {
  for (const suffix of suffixes) {
    const candidate = `${base}${suffix}`;
    try {
      await access(fileURLToPath(candidate));
      return candidate;
    } catch {
      // Try the next suffix.
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  // `@/*` is the tsconfig alias for the repo root, and components use it.
  if (specifier.startsWith("@/")) {
    const found = await firstExisting(
      new URL(specifier.slice(2), pathToFileURL(`${ROOT}${path.sep}`)).href,
      ["", ".ts", ".tsx", ".js", ".mjs"],
    );
    if (found) return { url: found, shortCircuit: true };
  }
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const base = new URL(specifier, context.parentURL ?? pathToFileURL(`${ROOT}${path.sep}`)).href;
    // `.js` in this tree means the `.ts`/`.tsx` beside it (the bundler's rule),
    // and owned imports are written without an extension at all.
    const suffixes = specifier.endsWith(".js")
      ? [".ts", ".tsx"]
      : path.extname(specifier)
        ? []
        : [".ts", ".tsx", ".mjs"];
    if (suffixes.length > 0) {
      const stripped = specifier.endsWith(".js") ? base.slice(0, -3) : base;
      const found = await firstExisting(stripped, suffixes);
      if (found) return { url: found, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".ts") || url.endsWith(".tsx")) {
    const source = await readFile(fileURLToPath(url), "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: COMPILER_OPTIONS,
      fileName: url,
    });
    return { format: "module", source: compiled.outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
