/**
 * The board reads a workflow's documents from its state dir, and the layout
 * puts the machine artifacts one level down (`plans/`, `context/`, `reviews/`)
 * beside the bookkeeping that shares the directory (`state.md`, `drafts/`).
 *
 * The fixture is a real state dir as the host reports it: one listing per
 * directory with `kind` on every entry, plus the content of every file. The
 * regression it exists for is the pairing — a top-level-only listing published
 * a bookkeeping file and hid every nested deliverable, and the gate handler
 * approves against exactly this list, so a nested spec could not be approved.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isDeliverableArtifactPath,
  unregisteredArtifactPaths,
} from "../lib/artifact-manifest.mjs";
import { boardFromRoot, findArtifacts } from "../server/runtime/board-read.ts";

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/board-artifacts/nested-workflow.json", import.meta.url),
    "utf8",
  ),
);
const stateDir = `${fixture.root}/.stelow/2026-09-26/${fixture.workflow.dirHash}`;
const relative = (absolute) => absolute.slice(`${fixture.root}/`.length);
const byPath = (left, right) => left.localeCompare(right);
const fixtureFiles = Object.keys(fixture.files);
const hasContent = (rel) => fixture.files[`${fixture.root}/${rel}`].trim().length > 0;

/** The host the fixture describes: per-directory listings, kind-tagged entries. */
function hostFiles(overrides = {}) {
  const listed = [];
  return {
    listed,
    read: async ({ path }) => {
      if (path === `${fixture.root}/stelow.json`) {
        return { content: JSON.stringify({ workflows: [fixture.workflow] }) };
      }
      const content = fixture.files[path];
      if (typeof content !== "string") throw new Error(`missing ${path}`);
      return { content };
    },
    listPaths: async ({ path, includeFiles, includeDirectories }) => {
      listed.push(path);
      const entries = fixture.dirs[path];
      if (!entries) throw new Error(`no such directory ${path}`);
      return {
        paths: entries.filter((entry) =>
          entry.kind === "directory" ? includeDirectories : includeFiles,
        ),
      };
    },
    ...overrides,
  };
}

test("nested workflow documents are board artifacts and bookkeeping is not", async () => {
  const files = hostFiles();
  const board = await boardFromRoot({ sdk: { files } }, fixture.root);
  assert.equal(board.error, null, "a complete fixture reads as a board");
  assert.deepEqual(
    board.workflows[0].artifacts.map((entry) => entry.path),
    [
      ".stelow/2026-09-26/sw-card_y6dnitl6/audit.md",
      ".stelow/2026-09-26/sw-card_y6dnitl6/context/context.md",
      ".stelow/2026-09-26/sw-card_y6dnitl6/explore/card_z9r4k/spec-product.md",
      ".stelow/2026-09-26/sw-card_y6dnitl6/plans/spec-product_v2.md",
      ".stelow/2026-09-26/sw-card_y6dnitl6/plans/spec-tech_v1.md",
      ".stelow/2026-09-26/sw-card_y6dnitl6/reviews/review-2026-09-26T09-40-00Z.md",
    ],
    "the walk reaches plans/, context/, reviews/ and a nested card dir, and state.md, "
    + "state.md.bak, drafts/, and the non-Markdown receipts stay out",
  );
  assert.deepEqual(
    board.workflows[0].artifacts.map((entry) => [entry.label, entry.kind]),
    [
      ["audit.md", "other"],
      ["context.md", "other"],
      ["spec-product.md", "product-spec"],
      ["spec-product_v2.md", "product-spec"],
      ["spec-tech_v1.md", "tech-plan"],
      ["review-2026-09-26T09-40-00Z.md", "other"],
    ],
    "a nested filename still classifies by its prefix, so the gate vocabulary applies",
  );
  assert.equal(
    board.workflows[0].stage,
    "execution",
    "the stage still comes from the workflow's own state.md",
  );
});

test("the board and the manifest bar agree on every file in the state dir", async () => {
  const files = hostFiles();
  const listed = new Set(
    (await findArtifacts(files, fixture.root, fixture.workflow)).map(
      (entry) => entry.path,
    ),
  );
  // The manifest bar is judged state-dir-relative; the board resolves the same
  // relative path before it asks, so a workspace under a `drafts/` parent is
  // not emptied by the rule.
  for (const absolute of fixtureFiles.filter((path) => path.startsWith(stateDir))) {
    const rel = relative(absolute);
    assert.equal(
      listed.has(rel),
      isDeliverableArtifactPath(rel) && hasContent(rel),
      `${rel} is listed exactly when the bar accepts it and the file has content`,
    );
  }
  // The card's sweep walks the same tree and applies the same bar; the only
  // step the board adds is the publishable-content check, applied here so the
  // two sets are comparable.
  const sweep = unregisteredArtifactPaths(
    fixtureFiles.filter((path) => path.startsWith(stateDir)).map(relative),
    [],
  ).filter(hasContent);
  assert.deepEqual(
    sweep.sort(byPath),
    [...listed].sort(byPath),
    "the card's unregistered sweep and the board name the same documents",
  );
});

test("a nested spec is approvable, because the gate handler reads this list", async () => {
  const files = hostFiles();
  const artifacts = await findArtifacts(files, fixture.root, fixture.workflow);
  const specs = artifacts.filter((entry) => entry.kind === "product-spec");
  assert.deepEqual(
    specs.map((entry) => entry.approved),
    [true, true],
    "both nested product specs carry the gate receipt, sorted by path",
  );
  assert.equal(
    files.listed.includes(`${stateDir}/plans`),
    true,
    "the walk listed the nested directory rather than assuming its contents",
  );
});

/** A listing that names its own directory, a parent, and one real area. */
function hostileListing({ path }) {
  if (path === stateDir) {
    return {
      paths: [
        { path: stateDir, kind: "directory" },
        { path: `${fixture.root}/.stelow/2026-09-26`, kind: "directory" },
        { path: `${stateDir}/audit.md`, kind: "file" },
        { path: `${stateDir}/plans`, kind: "directory" },
      ],
    };
  }
  if (path === `${stateDir}/plans`) {
    return { paths: [{ path: `${stateDir}/plans/spec-product_v2.md`, kind: "file" }] };
  }
  throw new Error(`no such directory ${path}`);
}

test("the walk stays inside the state dir and lists a path once", async () => {
  // The host's listPaths is promise-returning, as the read assumes.
  const files = hostFiles({ listPaths: async (args) => hostileListing(args) });
  const board = await boardFromRoot({ sdk: { files } }, fixture.root);
  assert.equal(board.error, null, "a hostile listing is still a board, not a failure");
  assert.deepEqual(
    board.workflows[0].artifacts.map((entry) => entry.path),
    [
      ".stelow/2026-09-26/sw-card_y6dnitl6/audit.md",
      ".stelow/2026-09-26/sw-card_y6dnitl6/plans/spec-product_v2.md",
    ],
    "a self-referential or outside directory entry is never descended into, "
    + "and the duplicated audit.md is listed once",
  );
});

test("an area the host cannot list contributes nothing instead of failing", async () => {
  const sealed = await findArtifacts(
    hostFiles({
      listPaths: async ({ path }) => {
        if (path === `${stateDir}/plans`) throw new Error("permission denied");
        const entries = fixture.dirs[path];
        if (!entries) throw new Error(`no such directory ${path}`);
        return { paths: entries };
      },
    }),
    fixture.root,
    fixture.workflow,
  );
  assert.equal(
    sealed.some((entry) => entry.path.includes("plans/")),
    false,
    "the sealed area is absent from the list, and the rest of the read stands",
  );
  assert.equal(
    sealed.some((entry) => entry.path.endsWith("context/context.md")),
    true,
    "one unreadable sibling does not empty the workflow's document list",
  );
});
