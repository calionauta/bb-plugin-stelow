# Rendered UI audit

The P2 lens of a card's verification pass, finally rendered.

## Why it exists

A card reached `done` three verification runs in a row with this row in its
record:

> **P2 UI quality audit** — *partial — Codebase mode only (~80%)*

The reason was structural, not diligence. Every component test in this repo read
its `.tsx` **as text** (`readFileSync`), never as a tree: `node --test` resolves
and strips types, but does not transform JSX, and esbuild is not a dependency.
So the suite could assert that a source string contains a sentence and could
never assert that a rendered control has an accessible name. A green run said
nothing about what a person would see.

## The DOM library, chosen by measurement

`tests/dom-setup.mjs` installs **happy-dom**. The three candidates were measured
on this host rendering a React 19 component with state, then querying it by role,
clicking it, and running axe (`dom-spike/bench.mjs`):

| library | setup | render / iteration | `getByRole` | click | axe | RSS |
|---|---:|---:|---|---|---|---:|
| **happy-dom** | 625ms | 3.7ms | ok | ok | ok | **124MB** |
| jsdom | 1160ms | 4.3ms | ok | ok | ok | 181MB |
| linkedom | 149ms | — | — | — | — | — |

linkedom never rendered: it has no `window.location`, and react-dom's event system
reads `location.protocol` at startup. It is deliberately partial, which is right
for parsing and wrong for this.

happy-dom versus jsdom is closer than the usual "5–10× faster" claim suggests:
**the render cost is React's, not the library's** (3.7 vs 4.3ms), and jsdom is
smaller on disk (8.7MB vs 19MB). The wins that are real are setup time (~2×) and
memory (~46% less), so happy-dom is the choice — but the honest summary is
"cheaper to start and lighter to hold", not "faster".

## What it can prove, and what it cannot

Proved by `tests/rendered-ui-audit.test.mjs`, which renders a real component and
then **fails on a knowingly broken one** — because a lens that cannot fail is not
evidence:

- a real component renders and its text is reachable by query, not by string match;
- axe runs on that tree and it stays clean under WCAG A/AA (a regression gate);
- a broken tree is flagged by rule name (`image-alt`, `button-name`).

**The measured limit, stated rather than implied:** axe finds interaction defects
by listening for DOM handlers, and a React `onClick` is attached at the React
root rather than on the element. `click-events-have-key-events` and its family
therefore **do not fire on a React tree at all**. A rendered audit covers
structure — names, alt text, roles, labels — and does not cover handler wiring.

That limit is the honest reason **P1 (the browser pass) is worth its cost**: a
real browser is what can drive a keyboard through a rendered control. P2 gets
native here; P1 stays a real, separate gap.

## Running it

```
npm run test:rendered-ui
```

It is part of `npm test`. The loader (`tests/register-tsx.mjs`) transforms TSX
with the `typescript` devDependency the repo already installs, resolves the
`@/*` tsconfig alias, and maps `.js` imports to the `.ts`/`.tsx` beside them —
no esbuild, no added toolchain.
