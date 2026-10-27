# Observability triage — reading the action log

How to follow what the plugin records, how to turn it into "what is still
wrong", and the exact workflow for asking an LLM to audit it. Design and the
kind catalog live in `docs/observability.md`; this file is the operator loop.

## 1. Where the signal lives

| Source | Command or path | Answers | Kept |
|---|---|---|---|
| Action log | `bb stelow log` | what the plugin did: RPCs, CLI verbs, decisions, effects, client errors | 30 days / 50k rows (`gc --apply`) |
| One card's story | `bb stelow log --card <id> --replay` | everything that happened to a card, in order | same |
| Card detail | Stelow card → **Activity** | the same rows on demand, newest 50 | same |
| Table size | `bb stelow storage` | rows / events / oldest, beside worktree sizes | live |
| Host headlines | `~/.bb/logs/server.*.log`, `~/.bb/plugins/stelow/logs/plugin.log` | warnings that are not card facts (SDK, reconcile errors) | host policy |
| Agent behavior | `bb.db` events (`bb thread log`) | what the *agent* did: turns, tool calls, commands | BB policy |
| CLI failures (legacy) | `~/.bb/logs/cli-errors.jsonl` | pre-0.93 CLI failures only; `bb stelow log` supersedes it | host policy |

The live install must run 0.93.0 or newer for the action log to exist:
`bb plugin list | grep stelow`. Update with `bb plugin update stelow --yes`.

## 2. The ten-minute sweep

Run these weekly, or before a release:

```bash
# 1. Is the recorder alive, and how busy is each seam?
bb stelow log --since 7d --limit 200 | head -40

# 2. Rates, not counts: refusals against the successes that now exist
bb stelow log --since 7d --kind cli.call --outcome refused --json | jq '{rows,events}'
bb stelow log --since 7d --kind cli.call --outcome ok      --json | jq '{rows,events}'

# 3. Rank causes across every kind (the one query the CLI does not have yet)
bb stelow log --since 7d --json --limit 5000 | node -e '
let raw="";process.stdin.on("data",d=>raw+=d).on("end",()=>{
  const {actions}=JSON.parse(raw); const by={};
  for(const a of actions){const k=`${a.kind} ${a.outcome}${a.cause?" "+a.cause:""}`;by[k]=(by[k]??0)+a.occurrences;}
  Object.entries(by).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(String(v).padStart(6),k));
});'

# 4. Are the two 45s heartbeats alive and how slow are they?
bb stelow log --since 1h --kind card.tick --json | jq '{rows,events,newest:.actions[0].lastAt}'
bb stelow log --since 1h --kind reconcile.tick --json | jq '{rows,events,newest:.actions[0].lastAt,maxMs:([.actions[].durationMs]|max)}'

# 5. Failures that lost their reason, and host stalls
bb stelow log --since 7d --cause run.no-reason --json
bb stelow log --since 7d --cause host.read-miss --json

# 6. What the browser reported
bb stelow log --since 7d --kind ui.error --json
```

What each number means:

- `rows` is distinct conditions; `events` is occurrences. A cause with 1 row and
  300 events is one standing failure, not 300 problems — and it is the loudest
  thing in the log. A folded row prints `first→last`; a stale `last` is the
  alarm, not a stale `first`. Its `durationMs` is the **worst** occurrence, so
  "the pass is slow" survives being averaged away.
- A **fresh** `lastAt` on `card.tick` / `reconcile.tick` proves the reconciler
  is running. A stale one means it died silently; that is the first thing to
  check when "nothing happens" on the board.
- A **rising share** of `cli.call refused` means a gate is refusing more often,
  not that the CLI is broken. Group by `cause` to see which gate.
- A **new cause** in the current window that was absent in the previous one is
  the closest thing to a regression alarm this log has.

## 3. The decision table

| Signal | Likely class | Next step |
|---|---|---|
| `rpc.call error` clustered on one method | plugin bug or contract mismatch | read the handler; the RPC wrapper recorded `detail.name` + message, not the input |
| `rpc.call refused` with `rpc.refused` | a handler answered `{ok:false}` | `detail.name` + `detail.error` say which verb and why; no crash happened |
| `rpc.validation` | contract mismatch (ours or upstream) | reproduce with the caller; BB's warn has no field path (get-bb/bb#6373) |
| `cli.call refused` with `cli.usage` | agent misuse of a verb | fix the worker prompt or the message; not a crash |
| `cli.call refused` with a domain cause (`done.*`, `retry.*`) | gate doing its job, maybe too often | compare with `ok`; if the rate is high, the gate or its copy is wrong |
| `run.finished error` + `run.no-reason` | host reported a failure with no message | `detail.native` holds the raw payload; usually a recipe that produced no output |
| `run.unreachable` | host stopped answering mid-run | correlate with `host.read-miss` and `bb.log` |
| `worker.restart` events climbing | spawn loop | check the preset's model against the provider catalog |
| `question.expired` with long `durationMs` | nobody answered | the wait is real; ask about the question's context, not the timeout |
| `question.persisted` frequent | the interaction ended but the card keeps it | check the timeout setting vs how people actually answer |
| `inbox.opened` much larger than `inbox.resolved` | attention rows are piling up | inspect the rules minting them; the badge is honest, the rules are not |
| `ui.error.<surface>.<hash>` | browser-side bug | `detail.stack` names the component; the cause groups repeats |
| `host.read-miss` | host event loop or transport | host-side; check the card's latch and the host logs |
| A kind that never appears | missing coverage | the seam is not instrumented, or the feature is unused |

## 4. Asking an LLM to audit it

The failure mode to avoid: pasting thousands of raw rows. The model spends its
context on the loudest rows and misses that a *rate* changed. Feed aggregates
first, then a handful of representatives.

**Collect (deterministic).** Run the sweep above and capture:

1. the cause ranking (command 3), as text;
2. the rate pair for `cli.call` (command 2);
3. heartbeat freshness and max duration (command 4);
4. `run.no-reason` and `ui.error` rows with `detail` (commands 5–6), capped at 20;
5. 10 raw rows from `bb stelow log --since 7d --limit 10`.

Wrap that in one text block and hand it to the model with this frame:

```text
You are auditing the Stelow plugin's own action log. Evidence only: every claim
must quote a row, a count, or a file:line you actually read. The kind catalog is
lib/action-kinds.mjs; the design rules are docs/observability.md.

Inputs you have: the aggregate snapshot above, plus a shell in this checkout.

For each signal, classify it as exactly one of:
  bug        the plugin did something wrong; name the file and the condition
  noise      the instrumentation is too broad; propose a narrower cause
  coverage   a real event has no row; name the seam that should emit one
  host       BB/provider/environment; say what to check outside this repo
  product    a workflow decision, not a defect; say who decides

Output a table: Signal | Evidence (count or row) | Class | Hypothesis |
How to confirm (command or file:line) | Proposed change | Confidence.

Rules:
- Never invent a cause string. Causes are dotted codes from the closed catalog.
- "How to confirm" must be something you can run or read; do not guess.
- Do not paste prompt bodies, file contents or assistant text; the log never
  carries them and your report should not either.
- If a signal is one row with many occurrences, say so; do not count it as many
  findings.
- Rank by expected value (frequency x blast radius), not by novelty.
```

**Verify (independent).** A second pass, with fresh context, gets only the
findings and must mark each `confirmed`, `refuted`, or `unverifiable`, checking
the code or running the query itself. The repo's own rule applies: the author
of a finding is not its verifier. Drop refuted and unverifiable items from the
action list; keep the evidence for why.

**Then fix.** A finding becomes work the same way any other change does:

1. the rule goes in `lib/` with a node test (authored by a fresh context, per
   `AGENTS.md`), or in the seam module when it is wiring;
2. the RPC/CLI surface changes stay one-liners in the wiring files;
3. a user-facing change updates `FEATURES.md` in the same commit;
4. branch → PR → squash merge; the release PR accumulates.

A useful convention: put the audit's confirmed findings on the board as one
card per class (bug / noise / coverage), not one card per row. The cause is the
unit of work, because the cause is what the log counts.

## 5. What the log will never tell you

- **Why the host failed**, when the host itself sent no reason. The row keeps
  the raw payload (`detail.native`), and that is the end of the evidence.
- **What an agent or a person typed.** Prompts, file contents and assistant
  text are never recorded; the card and the thread keep them.
- **Whether a product rule is right.** The log measures decisions, not their
  wisdom; `product` findings are for a person to decide.
- **A rate without a window.** Always pass `--since`; a bare count means
  nothing after the 30-day retention boundary.

## 6. First-week expectations

Right after the upgrade the log is mostly heartbeats (`card.tick`,
`reconcile.tick`) and the RPCs the panel makes. That is correct: causes appear
when work happens. Expect the first useful causes after a full work cycle —
one card through a stage advance, a `done`, a failed run, a question answered.

Two settings worth knowing:

- `STELOW_ACTION_LOG=0` in the plugin environment disables writes without a
  redeploy. Readers keep working against what is stored.
- `bb stelow gc --apply` prunes to 30 days / 50k rows and reports how many it
  dropped. A dry run prunes nothing.
