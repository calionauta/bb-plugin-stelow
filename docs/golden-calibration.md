# Golden calibration: from advisory judges to enforcement

Semantic judges (`bb stelow criteria`, router api modes) start advisory
and stay advisory until measured. This guide is the procedure that earns
enforcement. It is the only supported path from "the model says so" to
"the gate blocks on it."

## The rule

No semantic judgment blocks, auto-acts, or gates anything until its
criterion shows measured agreement with human labels. Mechanism without
calibration is decoration. The `review_policy` table (research/explore
`done`) already enforces this shape: the switch exists, the evidence
requirement is documented at the refusal, and flipping it early is
unsupported.

## The loop

1. **Label.** Write golden files in a card workspace: a `# Golden:`
   header with `skill:` + per-criterion `met`/`unmet` judgments, then
   `---`, then the artifact text. Aim 30–50 files per criterion;
   under 5 labels the verdict is always `repair` (more labels first).
2. **Measure.** Run `bb stelow goldens --skill <id> --file <path>
   [--file ...] [--card <card_id>] [--json]`. Output is Cohen's kappa
   per criterion: keep (≥ 0.6), repair, drop (near chance).
   Abstentions never enter kappa — they report separately.
3. **Repair.** For `repair` verdicts: rewrite the criterion text (more
   specific anchors), split conflated criteria in two, or grow the
   golden set. Re-run until keep or drop.
4. **Spot-check adversarially.** Reverse a criterion (or a golden
   verdict) and confirm the judgment flips. A judge that agrees with
   everything, including negations, measures nothing.
5. **Enforce.** Only for `keep` verdicts, and only the narrowest
   mechanism that the measurement supports (one criterion, one gate).
   Recalibrate when criteria text, judge model, provider, or
   thresholds change — a drifted criterion fails kappa and gets
   quarantined, not argued with.

## Thresholds

`routeAt` floors (per router, Manage agent presets → Decision routers)
gate acting, not truth: triage seeds at 0.6 (free, worker re-settles),
auto-continue vetoes at 0.7 (a resume spends a worker turn), criteria
scores at 0.6. Raise a floor only on golden evidence, never on vibes.

## Cost notes

One atomic call per criterion per file (never batched — shared reasoning
context conflates dimensions). classifier.dev's free tier covers
single-user calibration; Jev-schema providers bill input tokens per
call. Count criteria × files before a 200-file run.
