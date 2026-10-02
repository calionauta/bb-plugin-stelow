/**
 * Render a .tsx component to a plain tree, with no DOM, no bundler and no
 * runtime React.
 *
 * `ts.transpileModule` compiles the JSX and `createElement` is the only React
 * the output needs. This is the precedent `tests/preset-execution-picker.test.mjs`
 * established, extracted here so a structural claim about markup can be asked
 * OF the markup rather than of the source text that produced it.
 *
 * The reason it matters: a regex can be satisfied by an edit that changes what
 * the component does. A tree cannot. Every guard that had to be written as a
 * source grep because there was no other way to ask the question now asks it
 * here, and the mutation it refuses is one a human could make in ten seconds.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// This helper lives one level down from the repository root, so the root is
// resolved from here rather than assumed.
export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Compile one component out of a .tsx file and return it as a plain function.
 *
 * `stubs` maps a module specifier to what `require` should hand back, so a test
 * can substitute a dependency (a Pill, the shared logic module) without dragging
 * in its real import graph. An unstubbed specifier throws rather than silently
 * resolving to nothing: a missing stub is a broken test, not a green one.
 */
export function loadComponent(relativePath, exportName, stubs) {
  const compiled = ts.transpileModule(readFileSync(join(root, relativePath), "utf8"), {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: "fragment",
  };
  new Function("exports", "require", "module", "React", compiled)(
    module.exports,
    (specifier) => {
      if (specifier in stubs) return stubs[specifier];
      throw new Error(`Unexpected import: ${specifier}`);
    },
    module,
    React,
  );
  const component = module.exports[exportName];
  if (typeof component !== "function") {
    throw new Error(`${relativePath} exports no component named ${exportName}`);
  }
  return component;
}

/**
 * Depth-first over a rendered tree, rendering components as it goes. A JSX
 * element holds its type as an unevaluated function, so without this a `<Pill>`
 * stays an opaque node and no claim about it can be asked.
 */
export function walk(node, visit, depth = 0) {
  if (!node || typeof node !== "object" || depth > 20) return;
  if (typeof node.type === "function") {
    walk(node.type(node.props ?? {}, ...(node.children ?? [])), visit, depth + 1);
    return;
  }
  visit(node);
  for (const child of node.children ?? []) walk(child, visit, depth + 1);
}

export function findElementByType(node, type) {
  let found = null;
  walk(node, (current) => {
    if (!found && current.type === type) found = current;
  });
  return found;
}

export function findElementByClass(node, className) {
  let found = null;
  walk(node, (current) => {
    const value = current.props?.className;
    if (!found && typeof value === "string" && value.split(/\s+/).includes(className)) {
      found = current;
    }
  });
  return found;
}

/** The classes on a node, as a set-friendly array. */
export function classesOf(node) {
  const value = node?.props?.className;
  return typeof value === "string" ? value.split(/\s+/) : [];
}