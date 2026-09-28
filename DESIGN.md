# DESIGN.md — the card's design rules, and what enforces each one

## Why this file is a list of tests and not a style guide

A style guide is a promise. In 2026 the interesting question is not whether a
document states the rule but whether anything **fails when the rule is broken**.

This repo tried the other way first. `AGENTS.md` has said *"Touch targets are
`min-h-11`; every clickable gets `cursor-pointer`"* for a long time, and there
are 76 raw `<button>` elements next to a shared `ui/Button` that 50 files import
and 19 files never touch. A sentence in a markdown file does not intercept a
commit. A test does.

So the rule of this repository is narrow and worth stating plainly:

> **Every rule below is enforced by a named test. A rule with no test does not
> belong here — it belongs in a test.**

If you add a design rule, add the test in the same commit. If you cannot write
the test, that is evidence the rule is a preference, and preferences belong in
review, not in a document that pretends to be a contract.

What is left for a document is the part a test cannot hold: **why** the rule
exists, and the reasoning that a future change has to argue with. That is what
the rest of this file is.

---

## The rules

| Rule | Why | Enforced by |
|------|-----|-------------|
| A section is `SECTION_SURFACE`, or `DisclosureSection` | Eight siblings that do not match read as eight unrelated panels, and the reader judges importance by decoration instead of content | `card-surface-consistency` |
| Everything that makes a section differ is its **tone**, never a different border | Tone is a colour the reader already learned from the hero. A new border is a new thing to learn | `card-surface-consistency` |
| A disclosure picks one of three named families: `DisclosureSection`, `SUMMARY_ROW`, `SUMMARY_LINK` | Seven different summary paddings made the same accordion feel like a different control in every card | `card-design-tokens` |
| The chevron is `DisclosureChevron` | Twelve components shared the glyph while eight re-implemented the pattern around it | `card-design-tokens` |
| A section starts closed unless it is `live` or `blocking` | Progressive disclosure only works when the reader earns the opening. History does not get the first screen | `card-surface-consistency` |
| Every fact on the card has exactly one home | A summary strip restating the hero and two section hints added a fifteenth box to say what the card already said | `card-information-hierarchy` |
| A type size is on the scale, or an exception with a reason | A scale nobody can see cannot be followed | `card-design-tokens` |
| Touch targets are `min-h-11`; every clickable gets `cursor-pointer` | 44px, and a pointer that looks clickable | `AGENTS.md` — **not** enforced; see Known debt |

## The type scale

Four steps plus a tab, from `lib/design-tokens.ts`:

| Token | Size | Job |
|-------|------|-----|
| `TEXT_STATE` | 16px | The card's one authoritative state line. Exactly one per screen. |
| `TEXT_TAB` | 13px | A tab label. A target, not a label. |
| `TEXT_BODY` | 14px | Running text the reader reads rather than scans. |
| `TEXT_SECTION` | 11px | A section's own heading. |
| `TEXT_META` | 12px | Counts, timestamps, status words, lists of names. |

The order is deliberate and slightly counter-intuitive: `TEXT_SECTION` at 11px
sits **below** `TEXT_META` at 12px. Section headings are uppercase and
letter-spaced, so they read smaller than body text and still command the eye —
an inversion that only works because both halves are specified together. Split
them and you get either loud headings or unreadable ones.

`TYPE_EXCEPTIONS` lists the three sizes outside the scale, each with what earns
it: 10px for a literal model id where the string *is* the content, 15px for the
card's request text, 9px for superscript-grade annotation. A scale is only real
if its exceptions are listed.

## The three disclosure families

One interaction, three shapes, because they are three different jobs:

- **SECTION** — a labelled region of the card. `DisclosureSection`. Carries
  `SECTION_SURFACE` and the hero's tone vocabulary.
- **ROW** — a bordered thing with a header: a scope, a file in a diff, a tool
  card. `SUMMARY_ROW`.
- **LINK** — an inline "show more" inside running text. `SUMMARY_LINK`. It is
  `text-primary` because it is a control, and one of the two files that used to
  carry its own copy of that constant had dropped the colour, so the same "show
  more" read as a link in one place and as body text in another.

A site picks its family and adds only what is genuinely its own. It may not
re-spell the family's base — that is how one constant ended up duplicated under
one name in two files with different contents, which is the most expensive kind
of duplication, because nothing in review catches it.

## Writing a new component

1. **Look for the family first.** A row is `SUMMARY_ROW`, not a new
   `<details>`. A section is `DisclosureSection`, not a new `<section>`. A
   button is `ui/Button`, not a raw `<button>` unless it is a quiet inline
   control where the button's own weight would be wrong.
2. **Take a step from the scale**, do not pick a number.
3. **Run `npm test`.** The five `card-*` suites are fast and they are the
   review you do not have to do.

## Known debt, stated rather than hidden

- **`text-[11px]` in 102 places.** All the same size doing the same job, all
  now blessed by a scale that names it. The sites are owed a migration to
  `TEXT_SECTION`; the test blocks *growth* rather than demanding 124 files be
  rewritten in one commit, because a rule nobody can adopt in a sitting is a
  rule nobody adopts. This is the honest status for a debt this size: counted,
  not invisible.
- **`min-h-11` is unenforced.** Stated in `AGENTS.md` for a long time, never
  tested, and 76 raw buttons exist. It should be a test. It is listed here as
  the rule this document is least able to keep on its own.
- **A raw `<details>` is still legal** for a nested disclosure — a scope's
  acceptance criteria, one file in a diff, the worker's own history. Those carry
  no surface of their own and are progressive disclosure working one level down.
  The tests ban a hand-rolled `<details>` that *draws a section surface*, because
  that is what makes a second section.
