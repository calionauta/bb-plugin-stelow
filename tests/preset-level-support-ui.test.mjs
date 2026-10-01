/**
 * The preset list is where a stored reasoning level is read as a fact, so it is
 * the surface where an enum-but-unsupported level would otherwise be presented as
 * a choice that will be honoured. These assertions render the real component and
 * read the text it produces, because a source pin would still pass if the branch
 * that renders the warning were deleted from somewhere else.
 *
 * The regression they catch: the row printing `ultracode` next to a provider that
 * never declared it, with no signal, while the card runs at the provider default.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Load the real component with the host-free imports stubbed out. */
function loadPresetManagerList() {
  const source = readFileSync(
    join(root, "components/settings/preset-manager-list.tsx"),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  // Function components are invoked here rather than left as opaque nodes, or
  // the assertion would only ever see the element that wraps them and the text
  // a component renders would never be read.
  const React = {
    createElement: (type, props, ...children) => (
      typeof type === "function"
        ? type({ ...props, children })
        : { type, props, children }
    ),
  };
  const execute = new Function("exports", "require", "module", "React", compiled);
  execute(
    module.exports,
    (specifier) => {
      if (specifier === "../dashboard/build-status-pills") {
        return { Pill: (props, ...children) => ({ type: "Pill", props, children }) };
      }
      if (specifier === "@/components/ui/button") {
        return { Button: (props, ...children) => ({ type: "Button", props, children }) };
      }
      if (specifier === "./preset-manager-types") return {};
      throw new Error(`Unexpected import: ${specifier}`);
    },
    module,
    React,
  );
  return module.exports.PresetManagerList;
}

function renderRowText(listComponent, preset) {
  const noop = () => {};
  const tree = listComponent({
    presets: [preset],
    busy: false,
    onNew: noop,
    onEdit: noop,
    onSetDefault: noop,
    onDelete: noop,
  });
  const texts = [];
  const walk = (node) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (typeof node !== "object") {
      texts.push(String(node));
      return;
    }
    if (typeof node.props?.title === "string") texts.push(node.props.title);
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return texts.join(" ").replace(/\s+/g, " ");
}

const PresetManagerList = loadPresetManagerList();
const base = {
  id: "p_1",
  name: "Builder",
  providerId: "acp-opencode",
  modelId: "opencode/space-bunny-free",
  permissionMode: "full",
  environmentKind: "project-default",
  builtIn: false,
  isDefault: false,
};

const unsupported = renderRowText(PresetManagerList, {
  ...base,
  reasoningLevel: "ultracode",
  reasoningLevelSupported: false,
});
assert.match(
  unsupported,
  /ultracode \(unsupported here\)/,
  "a level the provider never declared is named as unsupported, not printed as a fact",
);
assert.match(
  unsupported,
  /does not declare this level/,
  "and the row says why, so the reader is not left guessing what unsupported means",
);

const supported = renderRowText(PresetManagerList, {
  ...base,
  reasoningLevel: "high",
  reasoningLevelSupported: true,
});
assert.match(supported, /high/, "a declared level is still shown");
assert.doesNotMatch(
  supported,
  /unsupported|not verified/,
  "a supported level carries no warning, or the warning stops being read",
);

const unverified = renderRowText(PresetManagerList, {
  ...base,
  reasoningLevel: "high",
  reasoningLevelSupported: null,
});
assert.match(
  unverified,
  /not verified/,
  "the host's silence renders as unverified, never as support",
);
assert.doesNotMatch(
  unverified,
  /unsupported here/,
  "an unreadable roster is not reported as a broken level",
);

console.log("preset level support ui test ok: unsupported, unverified, and supported rows render differently");
