# Security scans (tri-state)

A scan that did not run is not a clean scan. Every verdict is one of three,
never two:

| Exit | Meaning | When |
|------|---------|------|
| `0` | clean | full coverage and no finding at `--fail-on` (default `high`) |
| `1` | failed | a finding at threshold or above — fix, then re-scan |
| `2` | did not run | report missing, unreadable, unknown format, or incomplete coverage |

## Use

```bash
bb stelow scan --report <path> [--format auto|sarif|neutral] [--fail-on high] [--require-scanners semgrep,trivy]
```

The verdict records against the exact Git root + HEAD (`scan_runs`), the
same shape as `verification_runs`. `done` refuses without a recorded clean
scan at this HEAD. `verify --tests` warns the scan state early (warn-only,
never blocks) so it never ambushes at `done`.

## Report formats

- **SARIF 2.1.0** (Semgrep, CodeQL, Trivy): each `runs[]` entry is one
  scanner; `level` maps `error→high, warning→medium, note/none→low`. A run
  whose invocation reports `executionSuccessful: false` reads as not-ran.
- **Neutral**: `{ scanners: [{name, ran}], findings: [{severity, rule?, file?, line?}] }`.

## Known limit (shared with the AIDLC harness)

A SARIF from a tool that crashed without recording the invocation reads as
full coverage. Compensate with `--require-scanners`: any required scanner
without a `ran` entry forces exit `2`. A report naming zero scanners and
zero findings reads as did-not-run (nothing proven); findings below the
threshold with no roster read clean — the roster is what turns "nothing
found" into "something looked".

## Out of scope

The plugin reads a report file; downloading it from a platform is a pipeline
step. Accepted findings with expiry live in the gap-debt flow, not here —
record the expiry and owner there, re-scan after.
