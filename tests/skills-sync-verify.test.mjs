import assert from "node:assert/strict";
import { gitBlobSha } from "../lib/workflow-skills-sync.mjs";

// Git blob-sha vectors: sha1("blob <len>\0<content>").
assert.equal(gitBlobSha(""), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391", "empty blob vector");
assert.equal(gitBlobSha("hello"), "b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0", "hello blob vector");
assert.equal(gitBlobSha(Buffer.from("hello")), gitBlobSha("hello"), "Buffer and string agree");

// Guards the sync against CDN staleness: bytes whose blob sha differs from
// the tree sha must never be recorded as synced.
assert.notEqual(gitBlobSha("stale bytes"), gitBlobSha("fresh bytes"), "different bytes hash differently");

console.log("skills sync verify test ok: git blob-sha vectors");
