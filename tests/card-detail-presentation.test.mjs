import assert from "node:assert/strict";
import { archivedCardDetailPresentation } from "../lib/card-detail-presentation.mjs";

const archived = archivedCardDetailPresentation({ status: "archived", stage: "triage" }, (stage) => ({ triage: "Triage" })[stage] ?? stage);
assert.deepEqual(archived, {
  hero: { kind: "calm", title: "Archived", sub: "This card is kept for reference. No action is needed." },
  workflow: {
    title: "Workflow history",
    hint: "Ended at Triage",
    emptyScopes: "No scopes were created before this card was archived.",
    progressTitle: "Workflow progress",
    progressHint: "Archived before completion",
  },
}, "archived cards show one terminal state and retain only historical workflow context");
assert.equal(archivedCardDetailPresentation({ status: "in-progress", stage: "triage" }, (stage) => stage), null, "live cards keep their normal presentation");

console.log("card detail presentation test ok: archived cards stay terminal and historical");
