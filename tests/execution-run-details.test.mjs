import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatDuration } from "../lib/card-metrics.mjs";
import { relativeTime } from "../lib/relative-time.mjs";

/**
 * A run's row must be able to answer the question that makes someone open a
 * card: what happened to this run, and why.
 *
 * The row used to show recipe, status and stage, and every other field the RPC
 * already returned — the host's run id, the failure reason, the start and end
 * times, whether this was a retry, which adapter ran it — was dropped at the
 * type boundary. So a card with two failed runs and two successful ones read as
 * four undifferentiated lines, and the only way to learn why something failed
 * was to leave the card and go find the host's own transcript. Nothing about
 * the fix is a query: the data was already being sent.
 *
 * Two properties are load-bearing and pinned here. The details must be
 * REACHABLE (a disclosure the reader can open, and a deep link that arrives
 * with it already open), and they must not INVENT (no reason recorded says
 * exactly that, rather than dressing the absence up as a cause).
 */
const componentsDir = join(fileURLToPath(import.meta.url), "..", "..", "components", "detail");
const source = (file) => readFileSync(join(componentsDir, file), "utf8");

/** Every field the row may show, and whether the row is allowed to hide it. */
const RUN_FIELDS = [
  { name: "errorCode", label: "why it failed", always: false },
  { name: "startedAt", label: "when it ran", always: true },
  { name: "completedAt", label: "how long it took", always: false },
  { name: "runId", label: "the host's own run id", always: false },
  { name: "resumeOf", label: "whether this was a retry", always: false },
  { name: "adapter", label: "which adapter ran it", always: false },
];

test("the run type carries the fields the details show", () => {
  // The bug was a type boundary, not a missing query: these fields were on the
  // wire and absent from ExecutionRun, so no component could render them.
  const hook = source("use-execution-runs.ts");
  for (const field of RUN_FIELDS) {
    assert.ok(hook.includes(field.name), `ExecutionRun must carry ${field.name} (${field.label})`);
  }
});

test("the details are reachable: a toggle per row, and a deep link opens its run", () => {
  const section = source("execution-runs-section.tsx");
  assert.match(section, /aria-expanded=\{open\}/, "the toggle must expose its state to assistive tech");
  assert.ok(
    section.includes("useState(focusRunId === run.id)"),
    "a run a deep link just opened starts expanded, or the link answers its own question with a status label",
  );
  assert.ok(
    /\{open \? <ExecutionRunDetail/.test(source("execution-runs-section.tsx")),
    "the details must actually render when open, not just toggle a chevron",
  );
  // Closable on purpose: a disclosure nobody can dismiss is a dialog. The state
  // is seeded from the deep link, never forced — a plain toggle means the reader
  // can close it, which a `disabled` or a derived `open` would take away.
  assert.match(section, /onToggle=\{\(\) => setOpen\(\(value\) => !value\)\}/, "the toggle must flip the reader's own state");
});

test("a failed run with no recorded reason says so in those words", () => {
  const detail = source("execution-run-detail.tsx");
  assert.ok(detail.includes("run.errorCode"), "a recorded reason is shown when there is one");
  assert.ok(
    detail.includes("no reason was recorded"),
    "an absent reason is stated as absent — never rendered as a cause",
  );
});

test("the section header reports outcomes, not just an active count", () => {
  const section = source("execution-runs-section.tsx");
  assert.ok(
    section.includes("runOutcomeHint"),
    "a card whose four runs all finished must not report only '0 active'",
  );
  assert.ok(section.includes("failed"), "a failure count is the fact a reader is looking for");
});

test("durations read as durations, not as a re-basing clock", () => {
  // A relative clock re-bases every second, so two runs rendered side by side
  // would disagree with each other as the page ages. formatDuration is the
  // shared vocabulary for a length; relativeTime is for an event.
  const detail = source("execution-run-detail.tsx");
  assert.ok(detail.includes("formatDuration"), "lengths use the shared duration formatter");
  assert.ok(detail.includes("relativeTime"), "timestamps use the shared relative clock");
  assert.equal(formatDuration(45_000), "45s", "and the formatter is the one the rest of the card uses");
  assert.equal(typeof relativeTime(Date.now() - 3_600_000), "string");
});


