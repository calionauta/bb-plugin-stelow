/**
 * The mark's join into the card detail — the end-to-end path a click takes.
 *
 * What regresses if this fails: the door records a mark the card never shows
 * (or shows on the wrong file), so a reviewer marks five artifacts and the
 * section still says zero. Driven through the real detail handler, a real
 * SQLite database built by the plugin's migrations, and a real state dir on
 * disk; the mark is made through the RPC door, not written into the store, so
 * a wiring divergence between the door and the detail cannot pass here.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArtifactReviewHandlers } from "../server/runtime/artifact-reviews.ts";
import { readDetailArtifacts } from "../server/runtime/card-detail-artifacts.ts";
import { createCardDetailHandler } from "../server/runtime/card-detail.ts";
import { card, detailDeps } from "./helpers/card-detail-fixture.mjs";
import { freshDatabase, insertCard } from "./helpers/artifact-review-db.mjs";

/** One registered artifact on a fresh state dir, written the way a real one writes it. */
function seedArtifact(root) {
  const stateDir = join(root, ".stelow", "2026-10-25", "sw-review");
  mkdirSync(join(stateDir, "plans"), { recursive: true });
  const artifactPath = ".stelow/2026-10-25/sw-review/plans/spec.md";
  writeFileSync(join(root, artifactPath), "# spec\n\nWhat the card produced.\n");
  writeFileSync(join(stateDir, "state.md"), [
    "# Workflow state",
    "",
    "artifacts:",
    "  - stage: planning",
    "    kind: document",
    "    label: spec",
    `    path: ${artifactPath}`,
    "",
  ].join("\n"));
  return { stateDir, artifactPath };
}

/** The host read both surfaces share, with a mutable mtime. */
function readDeps(root, stateDir) {
  let modifiedAtMs = 1_790_000_000_000;
  const files = {
    read: async ({ path }) => {
      if (!existsSync(path)) throw new Error(`no such file: ${path}`);
      return { content: readFileSync(path, "utf8"), modifiedAtMs };
    },
    listPaths: async () => ({ paths: [] }),
  };
  return {
    deps: {
      bb: {
        sdk: {
          projects: { get: async () => ({ name: "Project" }) },
          files,
          threads: { get: async () => ({ environmentId: "env_1" }) },
        },
        realtime: { publish: () => undefined },
      },
      stateDir: async () => stateDir,
      fileTimestamp: (file, fallback) => (file?.modifiedAtMs ? new Date(file.modifiedAtMs).toISOString() : fallback),
      auditReceiptNote: () => null,
      workspaceRelative: () => null,
    },
    bumpMtime: () => { modifiedAtMs += 60_000; },
  };
}

/** A real detail + the review door over the same reader and database. */
function detailFixture() {
  const root = mkdtempSync(join(tmpdir(), "artifact-review-detail-"));
  const { stateDir, artifactPath } = seedArtifact(root);
  const read = readDeps(root, stateDir);
  const db = freshDatabase();
  const row = card({ id: "card_review", dir_hash: "sw-review", workspace_path: root });
  insertCard(db, row);
  const handler = createCardDetailHandler(detailDeps(row, {
    db,
    cardWorkspace: async () => ({ path: root, hostId: "host_1" }),
    fetchPendingQuestions: async () => [],
    ...read.deps,
  }));
  const reviews = createArtifactReviewHandlers({
    db,
    now: () => 42,
    getCard: () => row,
    readArtifacts: (entry) => readDetailArtifacts(read.deps, entry, root, "host_1"),
    publish: () => undefined,
    errors: { cardNotFound: "Card not found.", cardArchived: "This card is archived." },
  });
  return {
    row,
    artifactPath,
    open: () => handler({ cardId: row.id }),
    mark: () => reviews.markArtifactReviewed({ cardId: row.id, path: artifactPath }),
    bumpMtime: read.bumpMtime,
    close: () => { db.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

test("a mark made through the door appears on the detail row", async () => {
  const fixture = detailFixture();
  const before = await fixture.open();
  assert.equal(before.artifacts.length, 1);
  assert.equal(before.artifacts[0].reviewed, false, "nothing is reviewed on a fresh card");
  assert.equal(before.artifacts[0].stale, false);
  assert.equal(before.reviewLine, "0 of 1 reviewed");

  assert.deepEqual(await fixture.mark(), { ok: true, error: null });
  const marked = await fixture.open();
  assert.equal(marked.artifacts[0].reviewed, true, "the join puts the mark on the row");
  assert.equal(marked.reviewLine, "1 of 1 reviewed");
  fixture.close();
});

test("a file that changed after the mark reads stale, and leaves the count", async () => {
  const fixture = detailFixture();
  await fixture.mark();
  fixture.bumpMtime();
  const changed = await fixture.open();
  assert.equal(changed.artifacts[0].reviewed, false, "a changed file leaves the reviewed count");
  assert.equal(changed.artifacts[0].stale, true, "and says why instead of forgetting the mark");
  assert.match(changed.reviewLine, /1 reviewed before the file changed/);
  fixture.close();
});

console.log("artifact review detail ok: the door's mark lands on the row the reader sees");
