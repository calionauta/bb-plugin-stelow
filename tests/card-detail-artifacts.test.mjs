/**
 * The card's artifact list is the manifest PLUS the documents the workflow
 * wrote and never registered. The second half is what this file guards: it
 * comes from walking the state dir, and the state-dir layout puts documents
 * one level down (`plans/`, `reviews/`, `critiques/`). A top-level-only walk
 * therefore hid every nested document the agent forgot to declare, while the
 * board — reading the same directory — listed them. The card and the board
 * disagreed about what a card contained.
 *
 * The fixture is the real layout, and the fake host lists a directory the
 * way the real one does: entries relative to the directory that was asked
 * about, `kind` on every entry. Both properties are load-bearing — a walk
 * that trusts absolute paths, or one that stops at the top level, fails here.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readDetailArtifacts } from "../server/runtime/card-detail-artifacts.ts";

const ROOT = "/workspace/project";
const CARD_DIR_HASH = "sw-card_detail_artifacts";
const CREATED = "2026-09-26";
const STATE_DIR = `${ROOT}/.stelow/${CREATED}/${CARD_DIR_HASH}`;
const STATE_PATH = `${STATE_DIR}/state.md`;

/** state.md as a real one writes it: prose, then the `artifacts:` block. */
const STATE_MD = [
  "# Workflow state",
  "",
  "current_stage: planning",
  "",
  "artifacts:",
  "  - stage: planning",
  "    kind: document",
  "    label: spec product v1",
  `    path: .stelow/${CREATED}/${CARD_DIR_HASH}/plans/spec-product_v1.md`,
  "  - stage: planning",
  "    kind: document",
  "    label: spec tech v1",
  `    path: .stelow/${CREATED}/${CARD_DIR_HASH}/plans/spec-tech_v1.md`,
  "",
].join("\n");

const DOCUMENT = "# document\n\nReal content an agent produced.\n";

/** Every file in the state dir, with the shape the host reports entries in. */
const FILES = {
  [`${STATE_DIR}/state.md`]: STATE_MD,
  [`${STATE_DIR}/state.md.bak`]: STATE_MD,
  [`${STATE_DIR}/audit.md`]: DOCUMENT,
  [`${STATE_DIR}/plans/spec-product_v1.md`]: DOCUMENT,
  [`${STATE_DIR}/plans/spec-tech_v1.md`]: DOCUMENT,
  // Nested and NEVER registered: the card used to hide all three.
  [`${STATE_DIR}/plans/spec-tech_draft.md`]: DOCUMENT,
  [`${STATE_DIR}/critiques/critique-report.md`]: DOCUMENT,
  [`${STATE_DIR}/reviews/review-2026-09-26T09-40-00Z.md`]: DOCUMENT,
  // Nested bookkeeping and non-documents: the bar must keep them out.
  [`${STATE_DIR}/drafts/scratch.md`]: DOCUMENT,
  [`${STATE_DIR}/critiques/critique-report.json`]: "{ }",
  [`${STATE_DIR}/invariants.json`]: "{ }",
};

const relPath = (absolute) => absolute.slice(`${ROOT}/`.length);

/**
 * The host as the fixture describes it: per-directory listings whose paths are
 * relative to the listed directory, and a read that only answers for a file
 * that exists. `absoluteEntries` flips the listing to full paths, the other
 * shape a host may report, so both must produce the same list.
 */
function hostFiles({ files = FILES, absoluteEntries = false } = {}) {
  return {
    listPaths: async ({ path: dir }) => {
      const prefix = `${dir}/`;
      const entries = [];
      const directories = new Set();
      for (const absolute of Object.keys(files)) {
        if (absolute === dir || !absolute.startsWith(prefix)) continue;
        const tail = absolute.slice(prefix.length);
        const slash = tail.indexOf("/");
        if (slash < 0) {
          entries.push({ kind: "file", path: tail });
        } else {
          directories.add(tail.slice(0, slash));
        }
      }
      for (const name of [...directories].sort()) {
        entries.push({ kind: "directory", path: name });
      }
      return {
        paths: absoluteEntries
          ? entries.map((entry) => ({ ...entry, path: `${prefix}${entry.path}` }))
          : entries,
      };
    },
    read: async ({ path: absolute }) => {
      if (!(absolute in files)) throw new Error(`no such file: ${absolute}`);
      return { content: files[absolute], modifiedAtMs: 1_789_000_000_000 };
    },
  };
}

const CARD = {
  dir_hash: CARD_DIR_HASH,
  updated_at: 1_789_000_000_000,
};

function deps(files) {
  return {
    bb: { sdk: { files } },
    stateDir: async () => STATE_DIR,
    fileTimestamp: (file, fallback) =>
      file?.modifiedAtMs ? new Date(file.modifiedAtMs).toISOString() : fallback,
    auditReceiptNote: () => null,
    workspaceRelative: (rootPath, path) =>
      path.startsWith(`${rootPath}/`) ? path.slice(`${rootPath}/`.length) : null,
  };
}

const readArtifacts = (files) =>
  readDetailArtifacts(deps(files), CARD, ROOT, "host_biq5g27emb");

const pathsOf = (artifacts) => artifacts.map((artifact) => artifact.path).sort();

test("a nested document the manifest never registered is on the card", async () => {
  const artifacts = await readArtifacts(hostFiles());
  const paths = pathsOf(artifacts);

  for (const nested of [
    "critiques/critique-report.md",
    "plans/spec-tech_draft.md",
    "reviews/review-2026-09-26T09-40-00Z.md",
  ]) {
    assert.ok(
      paths.includes(`.stelow/${CREATED}/${CARD_DIR_HASH}/${nested}`),
      `${nested} is one level down in the layout, so a top-level-only walk misses it`,
    );
  }

  const draft = artifacts.find((artifact) => artifact.path.endsWith("plans/spec-tech_draft.md"));
  assert.equal(draft.kind, "unregistered", "a document nobody registered is labelled honestly");
  assert.equal(draft.stage, "unregistered", "an unregistered document has no stage to claim");
});

test("no registered document is lost, dropped, or relabelled", async () => {
  const artifacts = await readArtifacts(hostFiles());
  const byPath = new Map(artifacts.map((artifact) => [artifact.path, artifact]));

  const registered = new Map([
    ["plans/spec-product_v1.md", "spec product v1"],
    ["plans/spec-tech_v1.md", "spec tech v1"],
  ]);
  for (const [file, label] of registered) {
    const path = `.stelow/${CREATED}/${CARD_DIR_HASH}/${file}`;
    const entry = byPath.get(path);
    assert.ok(entry, `${file} is registered, so the walk must not replace it`);
    assert.equal(entry.stage, "planning", "the manifest owns the stage of a registered document");
    assert.equal(entry.display, label, "the manifest owns the label, not the filename");
    assert.notEqual(entry.kind, "unregistered", "a registered document keeps its declared kind");
  }

  const statePath = `.stelow/${CREATED}/${CARD_DIR_HASH}/state.md`;
  assert.equal(pathsOf(artifacts).filter((path) => path === statePath).length, 0,
    "state.md is the workflow's own bookkeeping, never a document on its card");
});

test("the card list does not depend on how the host shapes a listing", async () => {
  const relative = pathsOf(await readArtifacts(hostFiles()));
  const absolute = pathsOf(await readArtifacts(hostFiles({ absoluteEntries: true })));
  assert.deepEqual(absolute, relative, "a dir-relative and an absolute listing are the same tree");
});

test("a nested audit trail stays evidence, and nested non-documents stay out", async () => {
  const files = { ...FILES, [`${STATE_DIR}/reviews/audit-trail.md`]: DOCUMENT };
  const artifacts = await readArtifacts(hostFiles({ files }));
  const paths = pathsOf(artifacts);
  const trailPath = `.stelow/${CREATED}/${CARD_DIR_HASH}/reviews/audit-trail.md`;

  assert.ok(paths.includes(trailPath), "the audit trail is a document wherever it sits");
  assert.equal(
    artifacts.find((artifact) => artifact.path === trailPath).role,
    "evidence",
    "the trail is machine evidence, not a deliverable",
  );
  assert.equal(
    paths.includes(`.stelow/${CREATED}/${CARD_DIR_HASH}/drafts/scratch.md`),
    false,
    "a disposable draft is worker scratch, never an artifact",
  );
  assert.equal(
    paths.includes(`.stelow/${CREATED}/${CARD_DIR_HASH}/critiques/critique-report.json`),
    false,
    "the document bar is .md, so a sibling JSON report is not a document",
  );
});
