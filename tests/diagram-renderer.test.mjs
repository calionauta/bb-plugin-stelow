import assert from "node:assert/strict";
import test from "node:test";
import {
  createDiagramRendererHandlers,
  readDiagramRendererStatus,
} from "../server/runtime/diagram-renderer.ts";

/**
 * The bundled diagram renderer: pele ships with the plugin, so the status is
 * bundled-vs-absent, never host-binary present-vs-missing. A failed import
 * reads as absent with the install command as the detail, never as a throw:
 * the About card renders the answer either way.
 *
 * This file imports the real module, not a reimplementation of its branch: a
 * copy of the null-check here would pass while the shipped module broke.
 */

const PINNED = "9.9.9";
const INSTALL = "npm install pele@9.9.9";

test("a loaded renderer reads as present at the pin", () => {
  for (const loaded of [{}, { render: () => ({}) }]) {
    const status = readDiagramRendererStatus(loaded, PINNED, INSTALL);
    assert.equal(status.present, true, "any non-null object is a bundled renderer");
    assert.equal(status.version, PINNED, "the version is the pin it was asked with");
    assert.equal(typeof status.detail, "string");
    assert.ok(status.detail.includes(PINNED), "the detail names the pin it reports");
  }
});

test("an absent renderer names the install command, not a throw", () => {
  for (const loaded of [null, undefined]) {
    const status = readDiagramRendererStatus(loaded, PINNED, INSTALL);
    assert.equal(status.present, false);
    assert.equal(status.version, null, "an absent renderer has no version to report");
    assert.equal(typeof status.detail, "string");
    assert.ok(status.detail.includes(INSTALL), "the detail names the install command");
  }
});

test("the handler answers from the loader and never throws", async () => {
  const present = createDiagramRendererHandlers({
    loadPele: async () => ({}),
    pinned: PINNED,
    installCommand: INSTALL,
  });
  assert.deepEqual(
    await present.diagramRendererStatus(),
    readDiagramRendererStatus({}, PINNED, INSTALL),
    "a resolvable import is the bundled answer",
  );

  const rejected = createDiagramRendererHandlers({
    loadPele: async () => {
      throw new Error("Cannot find module 'pele'");
    },
    pinned: PINNED,
    installCommand: INSTALL,
  });
  const failed = await rejected.diagramRendererStatus();
  assert.equal(failed.present, false, "a failed import reads as absent");
  assert.equal(failed.version, null);
  assert.ok(failed.detail.includes(INSTALL), "and still names the install command");

  const empty = createDiagramRendererHandlers({
    loadPele: async () => null,
    pinned: PINNED,
    installCommand: INSTALL,
  });
  assert.equal(
    (await empty.diagramRendererStatus()).present,
    false,
    "a loader that resolves to nothing is absent, not present",
  );
});

console.log("diagram renderer test ok: bundled reads present at the pin, absent names the install");
