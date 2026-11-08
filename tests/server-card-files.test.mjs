/**
 * server/card-files.ts: the card's two file doors.
 *
 * `readCardFile` loads one document; `listCardFiles` names the viewable
 * documents beside it, and both the viewer's file row and the relative links
 * inside a document go through these handlers. They share one resolver and one
 * jail on purpose: a second path resolver for the "next file" hop would be a
 * second chance to escape the checkout.
 *
 * This file asks what the handlers DO, directly. The wiring half — that the
 * card server exposes them to the RPC surface — is pinned in
 * tests/server-cards.test.mjs.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createCardFileHandlers } from "../server/card-files.ts";
import { cardRpcContract } from "../server/card-rpc-contract.ts";

const CARD = { id: "card_1" };
const WORKSPACE = { path: "/workspace", hostId: "host_1" };
// `listPaths` answers with names relative to the directory it was asked for.
// The fixture says what the SDK says: `plan.json`, not `/workspace/plan.json`.
const FOLDERS = {
  "/workspace": ["notes.md", { path: "plan.json" }, ".hidden.md", "image.png", "raw.txt"],
  "/workspace/nested": ["child.md"],
};

/** A directory listing over the fixture: only entries in the requested folder. */
function folder(path) {
  return { paths: FOLDERS[path] ?? [] };
}

function handlers({ listPaths, read, workspace = WORKSPACE } = {}) {
  const requests = [];
  const bb = {
    sdk: {
      files: {
        read: read ?? (async () => ({ content: "artifact" })),
        listPaths: listPaths ?? (async (input) => {
          requests.push(input);
          return folder(input.path);
        }),
      },
    },
  };
  const files = createCardFileHandlers({
    bb,
    errors: { cardNotFound: "missing", workspaceUnavailable: "unavailable" },
    getCard: (id) => (id === CARD.id ? CARD : undefined),
    cardWorkspace: async () => workspace,
  });
  return { files, requests };
}

test("read card files rejects workspace escapes and reads text", async () => {
  const { files } = handlers();
  assert.equal(
    (await files.readCardFile({ cardId: CARD.id, path: "../secret" })).error,
    "Path escapes the workspace.",
  );
  assert.equal((await files.readCardFile({ cardId: CARD.id, path: "notes.md" })).content, "artifact");
});

test("read card files refuses a binary and truncates at the shared limit", async () => {
  const binary = handlers({ read: async () => ({ content: "a\0b" }) });
  assert.equal(
    (await binary.files.readCardFile({ cardId: CARD.id, path: "notes.md" })).error,
    "Not a readable text file.",
    "a NUL byte is not a document the viewer can render",
  );

  const big = handlers({ read: async () => ({ content: "x".repeat(200_001) }) });
  const result = await big.files.readCardFile({ cardId: CARD.id, path: "notes.md" });
  assert.equal(result.content.length, 200_000, "the truncation limit is the one the viewer was written against");
  assert.equal(result.truncated, true, "and the viewer is told the page is partial, so it never draws a mockup");

  const failing = handlers({ read: async () => { throw new Error("nope"); } });
  assert.equal(
    (await failing.files.readCardFile({ cardId: CARD.id, path: "notes.md" })).error,
    "Could not read the file.",
    "a host read failure is a named error, not an exception escaping the RPC",
  );
});

// The viewer's file row: a brief that names `alternatives.md` lets the reader
// open it without leaving the dialog. The list is navigation over the SAME
// jail as the read, so it filters by kind and by hidden-ness, and it never
// leaks an absolute path outside the workspace into a clickable control.
test("list card files names the viewable siblings", async () => {
  const { files, requests } = handlers();
  const listed = await files.listCardFiles({ cardId: CARD.id, path: "notes.md" });
  assert.equal(listed.error, null, "a file inside the workspace lists without an error");
  assert.equal(listed.directory, "", "the card root is the empty relative directory");
  assert.deepEqual(
    requests.at(-1),
    { path: "/workspace", includeFiles: true, includeDirectories: false },
    "the picker asks for the files of the folder it is reading, not a directory tree",
  );
  assert.deepEqual(
    listed.files.map((file) => file.name),
    ["notes.md", "plan.json", "raw.txt"],
    "dotfiles and images are dropped, string and object entries both survive, and the order is stable",
  );
  const plan = listed.files.find((file) => file.name === "plan.json");
  assert.equal(plan?.path, "plan.json", "the relative path is what readCardFile needs");
  assert.equal(plan?.absolutePath, "/workspace/plan.json", "the absolute path is what the editor target needs");
});

// The listing is worker-adjacent input: a host that answers with an absolute
// path outside the checkout must not become a clickable chip, however it was
// spelled. The sibling filter is the last line before a path reaches a button.
test("list card files never surfaces a path outside the workspace", async () => {
  const { files } = handlers({
    listPaths: async () => ({
      paths: [
        "/workspace/notes.md",
        "/workspace/plan.json",
        "/etc/passwd.md",
        "/workspace/../outside.md",
      ],
    }),
  });
  const listed = await files.listCardFiles({ cardId: CARD.id, path: "notes.md" });
  assert.deepEqual(
    listed.files.map((file) => file.name),
    ["notes.md", "plan.json"],
    "an absolute path outside the checkout is not a sibling, however it was spelled",
  );
  assert.ok(
    listed.files.every((file) => file.absolutePath.startsWith("/workspace/")),
    "every chip carries an absolute path the editor can open inside the checkout",
  );
});

test("list card files keeps a nested file's relative path", async () => {
  const { files } = handlers();
  const listed = await files.listCardFiles({ cardId: CARD.id, path: "nested/child.md" });
  assert.equal(listed.directory, "nested", "the directory is relative to the workspace, not the card file");
  assert.deepEqual(
    listed.files,
    [{ name: "child.md", path: "nested/child.md", absolutePath: "/workspace/nested/child.md" }],
    "a sibling two folders down still gets the relative path readCardFile takes",
  );
});

test("list card files refuses an escape, an unknown card, and a missing workspace", async () => {
  const { files } = handlers();
  assert.equal(
    (await files.listCardFiles({ cardId: CARD.id, path: "../secret.md" })).error,
    "Path escapes the workspace.",
    "the picker cannot walk out of the checkout",
  );
  const missing = await files.listCardFiles({ cardId: "card_missing", path: "notes.md" });
  assert.equal(missing.error, "missing", "an unknown card is the card store's error, not an empty list");
  assert.deepEqual(missing.files, [], "and it carries no files");

  const homeless = handlers({ workspace: null });
  assert.equal(
    (await homeless.files.listCardFiles({ cardId: CARD.id, path: "notes.md" })).error,
    "unavailable",
    "a card without a checkout names the unavailable workspace instead of listing the host",
  );
});

test("the listCardFiles contract is strict about its input", async () => {
  const input = cardRpcContract.listCardFiles.input;
  assert.equal(input.safeParse({ cardId: "card_1", path: "notes.md" }).success, true);
  assert.equal(input.safeParse({ cardId: "card_1", path: "notes.md", extra: true }).success, false,
    "an unexpected field is refused before the handler runs");
  assert.equal(input.safeParse({ cardId: "card_1", path: "" }).success, false, "an empty path is not a file");
});

console.log("card file doors ok: one jail for the read and the sibling list, filtered to viewable documents");
