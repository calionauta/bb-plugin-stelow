import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EXPOSURE_REASONS,
  dirtyPathsFromPorcelain,
  sharedCheckoutExposure,
  sharedCheckoutVerdict,
  threadsSharingCheckout,
} from "../lib/shared-checkout-exposure.mjs";

const CHECKOUT = "/home/dev/repos/app";

// The host's shape, from a real `bb thread list --json`.
const host = (id, path, extra = {}) => ({
  id, projectId: "p1", environmentId: "e1", providerId: "pi",
  title: "some work", status: "active", environmentPath: path,
  environmentIsWorktree: false, ...extra,
});

// The gap: a card whose preset falls back to `project-default` shares the
// project checkout with every other thread in it, and the claim ledger sees
// nothing — a thread outside the plugin never acquires a claim.
{
  const threads = [
    host("thr_me", CHECKOUT, { originPluginId: "stelow" }),
    host("thr_other", CHECKOUT),
  ];
  const others = threadsSharingCheckout(threads, { checkoutPath: CHECKOUT, excludeThreadId: "thr_me" });
  assert.deepEqual(others.map((t) => t.id), ["thr_other"], "the card's own worker is not an intruder on every card");
}

// A thread on another checkout is not sharing this one, however live it is.
{
  assert.deepEqual(
    threadsSharingCheckout([host("thr_x", "/elsewhere")], { checkoutPath: CHECKOUT }),
    [],
    "a different directory is not a shared checkout",
  );
}

// Nothing live here means nothing to say — an archived or idle-forever thread
// in the same directory is not a present risk.
for (const [label, extra] of [
  ["archived", { archivedAt: 1 }],
  ["deleted", { deletedAt: 1 }],
  ["done", { status: "done" }],
]) {
  assert.deepEqual(
    threadsSharingCheckout([host("thr_z", CHECKOUT, extra)], { checkoutPath: CHECKOUT }),
    [],
    `an ${label} thread in the directory raises nothing`,
  );
}

// A trailing slash is the same directory.
{
  assert.equal(
    threadsSharingCheckout([host("thr_s", `${CHECKOUT}/`)], { checkoutPath: CHECKOUT }).length,
    1,
    "a trailing slash does not make a different directory",
  );
}

// Porcelain v1: two status columns, then the path. Splitting on the first
// space would truncate a path that contains one, and a rename carries a
// second NUL-separated path.
{
  const dirty = dirtyPathsFromPorcelain(
    " M src/a.ts\0?? src/new file.ts\0R  old/name.ts -> new/name.ts\0",
  );
  assert.deepEqual(dirty, ["new/name.ts", "src/a.ts", "src/new file.ts"], "paths survive spaces, untracked files, and renames");
  assert.deepEqual(dirtyPathsFromPorcelain(""), [], "an empty status is no files");
  assert.deepEqual(dirtyPathsFromPorcelain(null), [], "and so is a missing one");
}

// A record that is not porcelain must not become a path claim. The two status
// columns and the space are the invariant, and a status line without them is
// something else entirely — naming it as a file would point the reader at a
// path no agent ever touched.
{
  assert.deepEqual(
    dirtyPathsFromPorcelain("garbage that is not porcelain\0"),
    [],
    "a record without the two status columns is not a file",
  );
  assert.deepEqual(dirtyPathsFromPorcelain("??\0"), [], "and neither is a truncated one");
  // `core.quotepath=false` keeps non-ASCII names literal, but a quoted path
  // from a status produced without it must not keep its quotes as part of the
  // name — a wrong file is worse than a missing one.
  assert.deepEqual(
    dirtyPathsFromPorcelain('?? "src/café.ts"\0'),
    ["src/café.ts"],
    "a quoted path is unquoted rather than reported with quotes in the name",
  );
}

// The answer the reader needs: which of MY held files are dirty in a tree
// someone else is in.
{
  const held = ["src/a.ts", "src/b.ts", "src/c.ts"];
  const result = sharedCheckoutExposure({
    heldFiles: held,
    dirtyPaths: " M src/a.ts\0?? src/b.ts\0 M src/unrelated.ts\0",
    threads: [host("thr_other", CHECKOUT)],
    checkoutPath: CHECKOUT,
  });
  assert.deepEqual(result.files, ["src/a.ts", "src/b.ts"], "only the files I hold AND that are dirty");
  assert.match(result.lines[0], /1 other thread/, "and the line says how many others are here");
  assert.match(result.lines[1], /^2 files you hold have uncommitted changes/, "counted correctly, pluralised correctly");
}

// The honesty constraint: this never claims to know WHICH thread touched a
// file, because nothing here can prove it — the working tree is shared and has
// no per-agent ownership.
{
  const two = sharedCheckoutExposure({
    heldFiles: ["src/a.ts"],
    dirtyPaths: " M src/a.ts\0",
    threads: [host("thr_1", CHECKOUT), host("thr_2", CHECKOUT)],
    checkoutPath: CHECKOUT,
  });
  assert.match(two.lines[0], /2 other threads/, "two threads are reported as two");
  // Not "the ids do not appear" — ids appearing is only one way to attribute.
  // The invariant is that no line names an agent as the author of a file,
  // whether by id, by index, or by the word "wrote".
  for (const id of ["thr_1", "thr_2"]) {
    assert.ok(
      !two.lines.some((line) => line.includes(id)),
      `no line credits ${id} with a file it was never shown to have written`,
    );
  }
  assert.doesNotMatch(
    two.lines.join(" "),
    /\b(wrote|edited|changed by|thread \d)\b/i,
    "and no line attributes a file to any agent at all, however it names it",
  );
}

// Dirty but not mine: someone else is working in the tree, none of my files
// are involved. That is not exposure, and inventing one would be noise.
{
  const clean = sharedCheckoutExposure({
    heldFiles: ["src/mine.ts"],
    dirtyPaths: " M src/theirs.ts\0",
    threads: [host("thr_other", CHECKOUT)],
    checkoutPath: CHECKOUT,
  });
  assert.equal(clean.files.length, 0, "another agent's unrelated work is not my exposure");
  assert.deepEqual(clean.lines, [], "so nothing is said about it");
}

// Alone in the checkout: the section stays closed even with dirty files.
{
  const alone = sharedCheckoutExposure({
    heldFiles: ["src/a.ts"],
    dirtyPaths: " M src/a.ts\0",
    threads: [host("thr_me", CHECKOUT, { originPluginId: "stelow" })],
    checkoutPath: CHECKOUT,
  });
  assert.deepEqual(alone.lines, [], "no other thread means nothing to report, dirty or not");
  assert.equal(alone.threads.length, 0);
}

// Malformed input is not an error and not a claim.
{
  assert.deepEqual(threadsSharingCheckout(null, { checkoutPath: CHECKOUT }), []);
  assert.deepEqual(threadsSharingCheckout([null, "x", {}], { checkoutPath: CHECKOUT }), []);
  assert.deepEqual(
    sharedCheckoutExposure({ heldFiles: null, dirtyPaths: null, threads: null, checkoutPath: null }).lines,
    [],
    "a card with no checkout path asks nothing",
  );
}

// The reader's sentence for a checked answer. Every reason in the exported list
// has to produce one, because a reason with no sentence falls back to whatever
// the fallback copy says — which is how "no readable checkout" and "nobody
// measured the overlap" both used to render as a clean checkout.
{
  for (const reason of EXPOSURE_REASONS) {
    const text = sharedCheckoutVerdict({ isolated: false, threads: 1, files: [], lines: [], reason });
    assert.equal(typeof text, "string", `reason ${reason} answers with a sentence`);
  }
}

// The load-bearing half of that: an answer nobody measured must never render as
// a measured clean one. `no-checkout` is the card with nothing to read at all,
// and the other three are the reasons where the check ran and could not finish.
{
  for (const reason of ["unknown-footprint", "unreadable-tree", "unavailable", "no-checkout"]) {
    const text = sharedCheckoutVerdict({ isolated: false, threads: 2, files: [], lines: [], reason });
    assert.doesNotMatch(
      text,
      /No other agent is working/,
      `${reason} is not a clean checkout, and must not read as one`,
    );
  }
}

// The two answers that ARE clean say so plainly, and the two that carry their
// own lines say nothing here — duplicating them would be two homes for one fact.
{
  assert.equal(sharedCheckoutVerdict({ reason: "isolated", threads: 0, lines: [] }), "");
  assert.match(
    sharedCheckoutVerdict({ reason: "shared", threads: 1, files: ["src/a.ts"], lines: ["a line"] }),
    /^$/,
    "a shared checkout's lines already say it",
  );
  assert.match(
    sharedCheckoutVerdict({ reason: "no-threads", threads: 0, lines: [] }),
    /No other agent is working in this checkout\.$/,
  );
  assert.match(
    sharedCheckoutVerdict({ reason: "no-overlap", threads: 3, lines: [] }),
    /none of the files you hold are dirty there/,
    "others are in here; none of my files are involved",
  );
}

// The count is carried into the sentence, so "there are agents here" is a fact
// the reader gets even when no file could be compared.
{
  const one = sharedCheckoutVerdict({ reason: "unknown-footprint", threads: 1, files: [], lines: [] });
  const many = sharedCheckoutVerdict({ reason: "unknown-footprint", threads: 4, files: [], lines: [] });
  assert.match(one, /^1 other agent is in this checkout\./);
  assert.match(many, /^4 other agents are in this checkout\./);
}

// A reason this function has never heard of says nothing. A wrong sentence
// reads as a fact; silence reads as a missing sentence, which is the honest
// failure and the one a reader can go and ask about.
{
  assert.equal(sharedCheckoutVerdict({ reason: "invented-later", threads: 1, files: [], lines: [] }), "");
  assert.equal(sharedCheckoutVerdict(null), "");
}

// One home for this copy. The reader used to carry its own two-branch fallback,
// which handed every reason it did not recognise — a card with no readable
// checkout, and everything measured-unknown — the same clean sentence. The
// function above is the only place a verdict sentence may be written down.
{
  const component = readFileSync(
    new URL("../components/detail/file-occupancy.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    component,
    /sharedCheckoutVerdict/,
    "the reader delegates to the shared verdict rather than choosing a sentence",
  );
  for (const reason of EXPOSURE_REASONS) {
    const text = sharedCheckoutVerdict({ isolated: false, threads: 1, files: [], lines: [], reason });
    if (!text) continue;
    assert.ok(
      !component.includes(text),
      `the reader must not hold a second copy of the ${reason} sentence: "${text}"`,
    );
  }
}

console.log("shared checkout exposure test ok: another thread in this checkout, and which of my files it dirtied");
