# Smoke test: one real build card on opencode / deepseek-v4.1-flash / high

You are running a **product smoke test**, not a code change. The batch you are
testing merged minutes ago (PR #410 on master).

## Goal

Create ONE real card in this project, start it in **build**, using a preset whose
provider is **opencode**, model **deepseek-v4.1-flash** (whatever id the catalog
lists closest to that), reasoning **high**. Then follow it to a terminal state and
report what actually happened.

## Rules

1. **Use the documented path.** Find how a card is created and a build is started
   by reading what ships: `bb stelow --help` and its subcommands, `FEATURES.md`
   (presets), `docs/`. Do not invent an RPC.
2. **Invent nothing about the model.** Run `bb provider models --provider opencode`
   (or the documented equivalent) and use the real id. If deepseek-v4.1-flash is
   not listed, stop and report that; do not substitute silently.
3. **Irreversible steps need a stop.** Do not delete cards, do not archive
   anything, do not run `advance` on a card you did not create, and do not touch
   `skills/` or `data/stelow`.
4. **Watch, do not poke.** Follow the worker through the card's own surfaces
   (thread state, `bb stelow status --json`, the card detail). Record timestamps
   for: card created, build started, first stage entered, artifact written, first
   question (if any), terminal state.
5. **Capture the prompt evidence.** The cache-economy change is what you are
   testing as much as the provider: if the card's worker prompt is logged or
   inspectable, note the cacheable prefix reported and the token counts.
6. If the build fails, capture the exit, the stage, and the error text verbatim.
   A failed smoke test that reports why is a success; a "looks fine" is not.

## Deliverable

`docs/audits/2026-10-23-card-smoke-record.md` committed on a branch
`smoke/build-card-2026-10-23` in your own worktree: the card id, the preset used
and the model id it resolved to, the timeline, the stage path, the artifact path,
every question asked, the terminal state, and the prompt/token evidence.

Report under 200 words: did a real build card complete on that provider, what did
it cost in tokens, and what a human should look at first.
