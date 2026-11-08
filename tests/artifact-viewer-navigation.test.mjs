/**
 * The viewer's navigation, rendered — not grepped.
 *
 * Requirement: a brief that names the stage's other documents lets the reader
 * open them in the SAME dialog. The file row is the affordance; the relative
 * Markdown link is the second door; Back returns to the document the reader came
 * from. The path arithmetic is pure and covered in tests/artifact-nav.test.mjs.
 *
 * This file covers the two halves that a pure rule cannot:
 *
 *   - the state machine that turns "open this sibling" into a reading session,
 *     including the branch that resets ONLY on a different document (a parent
 *     re-render must not throw the reader back to the first file);
 *   - the DOM adapter in the dialog, `followArtifactLink`: it reads the anchor,
 *     forwards the modifier keys, claims the click, and calls the navigator. The
 *     pure rule can be green while the adapter never runs, drops `ctrlKey`, or
 *     lets the browser navigate away under the dialog.
 *
 * The two failed shapes this guards against are concrete: a viewer that opens
 * one file and stops (the interface gate opened `interfaces.md`, a summary,
 * while `alternatives.md` held every wireframe), and a file row that marks no
 * current file, so the reader cannot tell which document they are looking at.
 */
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const WORKSPACE = "/work";
const DIR = `${WORKSPACE}/interfaces`;
const INTERFACES = `${DIR}/interfaces.md`;
const ALTERNATIVES = `${DIR}/alternatives.md`;
const CONTRAST = `${DIR}/contrast.json`;

const FILES = [
  { name: "alternatives.md", path: "interfaces/alternatives.md", absolutePath: ALTERNATIVES },
  { name: "contrast.json", path: "interfaces/contrast.json", absolutePath: CONTRAST },
  { name: "interfaces.md", path: "interfaces/interfaces.md", absolutePath: INTERFACES },
];

// One stub for every RPC the viewer makes, recording each call so a branch can
// be asked about by its effect rather than by a spy on the component.
const calls = [];
const rpc = {
  call: async (method, input) => {
    calls.push({ method, input });
    if (method === "listCardFiles") {
      return { directory: "interfaces", files: FILES, error: null };
    }
    if (method === "readCardFile") {
      return input.path.endsWith("interfaces.md")
        ? { content: "Open [the alternatives](alternatives.md) next.", truncated: false, error: null }
        : { content: "# Alternatives\n", truncated: false, error: null };
    }
    throw new Error(`unexpected rpc method in the viewer: ${method}`);
  },
};
globalThis.__bbPluginRuntime = {
  pluginSdkApp: {
    useRpc: () => rpc,
    // The host's Markdown tree is not the subject; the one shape this file
    // needs is a relative link, so the stub parses exactly one.
    Markdown: ({ content }) => {
      const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(content);
      return h("div", null, link ? h("a", { href: link[2] }, link[1]) : content);
    },
    experimental_SourceCode: ({ content }) => h("pre", null, content),
    experimental_FileLink: () => null,
    UrlLink: () => null,
  },
};

const { useArtifactNavigation } = await import("../components/detail/use-artifact-navigation.ts");
const { ArtifactFileList } = await import("../components/detail/artifact-file-list.tsx");
const { ArtifactViewerDialog } = await import("../components/detail/artifact-viewer-dialog.tsx");

const listCalls = () => calls.filter((call) => call.method === "listCardFiles");
const readPaths = () => calls
  .filter((call) => call.method === "readCardFile")
  .map((call) => call.input.path);

/* ---------------------------------------------------------- file row --- */

function renderFiles(overrides = {}) {
  const opened = [];
  const backs = [];
  render(h(ArtifactFileList, {
    files: [
      { name: "alternatives.md", path: "interfaces/alternatives.md", absolutePath: ALTERNATIVES },
      { name: "interfaces.md", path: "interfaces/interfaces.md", absolutePath: INTERFACES },
    ],
    currentPath: INTERFACES,
    canGoBack: false,
    onOpen: (file) => opened.push(file),
    onBack: () => backs.push(true),
    ...overrides,
  }));
  return { opened, backs };
}

const row = renderFiles();
const nav = screen.getByRole("navigation", { name: "Related files in this folder" });
assert.equal(nav.querySelectorAll("button").length, 2, "one chip per sibling, and no Back before the first navigation");
const current = screen.getByRole("button", { name: "interfaces.md" });
assert.equal(current.getAttribute("aria-current"), "page", "the document on screen is the marked one");
assert.equal(screen.getByRole("button", { name: "alternatives.md" }).getAttribute("aria-current"), null,
  "a sibling is not marked as current");
fireEvent.click(screen.getByRole("button", { name: "alternatives.md" }));
assert.equal(row.opened.length, 1, "clicking a chip asks for that file");
assert.equal(row.opened[0].absolutePath, ALTERNATIVES);
cleanup();

// The viewer carries the workspace-RELATIVE path in production (the dialog's
// `file.path` is what readCardFile takes), so the marker must recognize it too.
// Pinning only the absolute branch left the real card with no current file.
renderFiles({
  files: FILES,
  currentPath: "interfaces/interfaces.md",
  onOpen: () => {},
  onBack: () => {},
});
assert.equal(screen.getByRole("button", { name: "interfaces.md" }).getAttribute("aria-current"), "page",
  "the current file is marked from the relative path the viewer actually carries");
assert.equal(screen.getByRole("button", { name: "alternatives.md" }).getAttribute("aria-current"), null);
cleanup();

const withBack = renderFiles({ canGoBack: true });
assert.ok(screen.getByRole("button", { name: "← Back" }), "after a navigation there is a way back");
fireEvent.click(screen.getByRole("button", { name: "← Back" }));
assert.equal(withBack.backs.length, 1, "and it is the navigator's back, not a browser reload");
cleanup();

render(h(ArtifactFileList, {
  files: [{ name: "only.md", path: "only.md", absolutePath: `${WORKSPACE}/only.md` }],
  currentPath: `${WORKSPACE}/only.md`,
  canGoBack: false,
  onOpen: () => {},
  onBack: () => {},
}));
assert.equal(screen.queryByRole("navigation", { name: "Related files in this folder" }), null,
  "a directory with one file and no history has nothing to navigate, so it renders no row");
cleanup();

/* ------------------------------------------------------- state machine --- */

function NavHarness() {
  const state = useArtifactNavigation(
    true,
    // Rebuilt on every render on purpose: the hook must reset on the document's
    // IDENTITY, not on the object, or a parent RPC reply lands the reader back
    // on the first file.
    { display: "interfaces.md", path: INTERFACES, target: { kind: "host", hostId: "host_1", path: INTERFACES } },
    "card_1",
  );
  const chip = { name: "contrast.json", path: "interfaces/contrast.json", absolutePath: CONTRAST };
  return h("div", null,
    h("span", { "data-testid": "current" }, state.current?.display ?? ""),
    h("span", { "data-testid": "target" }, state.current?.target?.path ?? ""),
    h("span", { "data-testid": "files" }, state.files.map((file) => file.name).join("|")),
    h("span", { "data-testid": "back" }, String(state.canGoBack)),
    h("button", { onClick: () => state.openPath(ALTERNATIVES) }, "open-linked"),
    h("button", { onClick: () => state.openFile(chip) }, "open-chip"),
    h("button", { onClick: () => state.openPath(`${WORKSPACE}/outside.md`) }, "open-outside"),
    h("button", { onClick: state.back }, "back"),
  );
}

const view = render(h(NavHarness));
await waitFor(() => assert.match(screen.getByTestId("files").textContent, /alternatives\.md/));
assert.deepEqual(listCalls()[0]?.input, { cardId: "card_1", path: INTERFACES },
  "the viewer asks the host for the directory it is reading");
assert.equal(screen.getByTestId("current").textContent, "interfaces.md", "the viewer starts on the document it was opened with");
assert.equal(screen.getByTestId("target").textContent, INTERFACES, "and keeps that document's editor target");
assert.equal(screen.getByTestId("back").textContent, "false", "nothing to go back to on arrival");

fireEvent.click(screen.getByText("open-linked"));
assert.equal(screen.getByTestId("current").textContent, "alternatives.md", "a relative link opens the next document in the same dialog");
assert.equal(screen.getByTestId("target").textContent, ALTERNATIVES,
  "the editor target follows the file the reader is actually looking at");
assert.equal(screen.getByTestId("back").textContent, "true", "and the previous document is one step away");

view.rerender(h(NavHarness));
assert.equal(screen.getByTestId("current").textContent, "alternatives.md",
  "a parent re-render with an equal location does not reset the reader to the first file");
assert.equal(screen.getByTestId("back").textContent, "true", "and does not clear the way back");

fireEvent.click(screen.getByText("back"));
assert.equal(screen.getByTestId("current").textContent, "interfaces.md", "Back returns to the document the reader came from");
assert.equal(screen.getByTestId("back").textContent, "false", "and the stack is empty again");

fireEvent.click(screen.getByText("open-chip"));
assert.equal(screen.getByTestId("current").textContent, "contrast.json", "a chip from the file row opens the sibling it names");
assert.equal(screen.getByTestId("target").textContent, CONTRAST,
  "the editor target is the sibling's absolute path, not the file it was opened from");
assert.equal(screen.getByTestId("back").textContent, "true", "and the file the reader left is one step back");
fireEvent.click(screen.getByText("back"));
assert.equal(screen.getByTestId("current").textContent, "interfaces.md", "Back from a picked sibling returns to the origin");

fireEvent.click(screen.getByText("open-outside"));
assert.equal(screen.getByTestId("current").textContent, "outside.md",
  "a document outside the listed directory still opens — the server, not the picker, decides reachability");
assert.equal(screen.getByTestId("target").textContent, "",
  "but no editor target is invented for a path the picker cannot map");
cleanup();

/* --------------------------------------------------- the dialog adapter --- */

// The pure rule decides WHAT a click means. This decides WHETHER the rule runs:
// the anchor is found from the event target, the modifier keys are forwarded,
// the event is claimed, and the navigator is called. Each is a separate way for
// a green pure test to sit on top of a dead viewer.

calls.length = 0;
render(h(ArtifactViewerDialog, {
  open: true,
  onOpenChange: () => {},
  cardId: "card_1",
  file: { display: "interfaces.md", path: "interfaces/interfaces.md" },
  editorTarget: { kind: "host", hostId: "host_1", path: INTERFACES },
  mode: "review",
  onCommented: () => {},
}));

await waitFor(() => assert.ok(screen.getByText("the alternatives")), { timeout: 3000 });
assert.deepEqual(readPaths(), ["interfaces/interfaces.md"], "the dialog loads the document it was opened with");

const link = screen.getByText("the alternatives");
assert.equal(fireEvent.click(link, { ctrlKey: true }), true,
  "a modified click is not claimed: the browser's own new-tab contract wins");
assert.deepEqual(readPaths(), ["interfaces/interfaces.md"], "and the viewer does not navigate behind it");

assert.equal(fireEvent.click(link), false,
  "a plain click is claimed, so the browser does not also follow the link out of the app");
await waitFor(() => assert.ok(screen.getByRole("heading", { name: "alternatives.md" })), { timeout: 3000 });
assert.deepEqual(
  readPaths(),
  ["interfaces/interfaces.md", "interfaces/alternatives.md"],
  "the relative link opens the sibling through the same reader, resolved against the current document",
);
assert.ok(screen.getByRole("button", { name: "← Back" }), "and the dialog renders the way back");

fireEvent.click(screen.getByRole("button", { name: "← Back" }));
await waitFor(() => assert.ok(screen.getByRole("heading", { name: "interfaces.md" })));
assert.equal(readPaths().at(-1), "interfaces/interfaces.md", "Back reloads the document the reader came from");
cleanup();

console.log("artifact viewer navigation ok: siblings open in place, the current file is marked, and Back returns");
