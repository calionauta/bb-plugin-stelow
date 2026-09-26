import assert from "node:assert/strict";
import {
  boundaryAnswerError,
  boundaryRunPatch,
  readCurrentBoundaryVersions,
} from "../server/execution-boundary.ts";

const nativeBoundary = {
  question: "Approve this boundary?",
  questionId: "question-1",
  contractId: "contract-1",
  kind: "confirmation",
  shapeVersion: "v3",
  scopeMapVersion: "map-1",
  answerSchema: { type: "object" },
};
const patch = boundaryRunPatch(nativeBoundary, "boundary-1");
assert.deepEqual(patch.issues, [], "native boundary fields become a durable contract");
assert.equal(patch.patch.boundaryId, "boundary-1");
assert.equal(patch.patch.boundaryContract.status, "open");

const invalid = boundaryRunPatch({ question: "Missing identity" }, "boundary-2");
assert.ok(invalid.issues.length, "malformed native boundaries fail closed");
const contract = patch.patch.boundaryContract;
assert.equal(
  boundaryAnswerError(contract, { shapeVersion: "v3", scopeMapVersion: "map-1" }, "yes"),
  null,
  "current answer version resumes",
);
assert.match(
  boundaryAnswerError(contract, { shapeVersion: "v4", scopeMapVersion: "map-1" }, "yes") ?? "",
  /no longer current/,
  "stale Shape version refuses resume",
);

const files = {
  "/state/state.md": "shape_version: v4",
  "/state/scope-map.json": JSON.stringify({
    schemaVersion: 1,
    mapId: "map-2",
    status: "approved",
    shapeVersion: "v4",
    provenance: ["simulation:boundary"],
    approval: { receiptId: "approval-2", approvedBy: "simulation" },
    openDecisions: [],
    scopes: [{
      id: "scope-1",
      title: "One",
      outcome: "One outcome",
      capabilities: ["core"],
      inScope: ["one behavior"],
      outOfScope: [],
      dependsOn: [],
      status: "current",
    }],
  }),
};
const bb = {
  sdk: {
    files: {
      read: ({ path }) => files[path]
        ? Promise.resolve({ content: files[path] })
        : Promise.reject(new Error("missing")),
    },
  },
};
assert.deepEqual(
  await readCurrentBoundaryVersions(bb, "/state", { shapeVersion: "v3", scopeMapVersion: "map-1" }),
  { shapeVersion: "v4", scopeMapVersion: "v4" },
  "current Shape and Scope Map versions come from card-owned state",
);
console.log("execution boundary test ok: durable contract, stale refusal, current versions");
