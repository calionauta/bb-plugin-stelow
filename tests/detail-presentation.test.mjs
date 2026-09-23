import assert from "node:assert/strict";
import { joinStrategyLabels, liveBorderClass, statusTone } from "../lib/detail-presentation.mjs";

const labels = new Map([["jtbd", "JTBD"], ["opportunity", "Opportunity Mapping"]]);
assert.equal(joinStrategyLabels(["jtbd", "opportunity"], labels), "JTBD + Opportunity Mapping", "strategy labels preserve run order");
assert.equal(joinStrategyLabels(["jtbd", "jtbd", null], labels), "JTBD", "duplicate and missing strategies never repeat");
assert.equal(joinStrategyLabels(["unknown"], labels), "unknown", "an unmapped strategy keeps its raw id while the catalog loads");
assert.equal(joinStrategyLabels([], labels), null, "no strategies means no label");

assert.equal(statusTone("done"), statusTone("completed"), "terminal aliases share one tone");
assert.equal(statusTone("failed"), "bg-destructive/15 text-destructive", "failure is destructive");
assert.equal(statusTone("unknown"), "bg-muted text-muted-foreground", "unknown status fails soft to neutral");

assert.equal(liveBorderClass({ activity: "running", needsAttention: false }), "stelow-border-running", "running has live motion");
assert.equal(liveBorderClass({ activity: "idle", needsAttention: true }), "stelow-border-attention", "attention wins over ordinary idle");
assert.equal(liveBorderClass({ activity: "idle", needsAttention: false }), "", "settled cards have no transient border");

console.log("detail presentation test ok: strategy labels, status tones, and live borders");
