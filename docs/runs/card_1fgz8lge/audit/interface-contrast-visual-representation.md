# Does the interface-contrast skill give the user a visual representation?

Card `card_1fgz8lge` — investigate: whether the interface-contrast skill and its
substage show ASCII mockup or any other visual option for the user to look at.

## The question

The user asked the sharp version of the question: if the user has no visual
representation and only a more structured explanation, how can they possibly
have a first reaction at all?

The answer is **no** — the contrast stage is textual throughout, and that is a
real weakness, not a missing feature.

## What the user actually sees

1. **The decision question plus a structured briefing** (step 2 of the method):
   decision question, fixed constraints, acceptance criteria, and missing
   evidence. This is the "more structured explanation" — it exists, but it is
   prose, not a picture.
2. **The first reaction is collected before the agent's synthesis** (step 3:
   "Preserve the decision-maker's first reaction before showing agent
   synthesis"). So the design assumes the user already arrives with context —
   they took part in the Shape stage, they know the spec and the scope map —
   and they react to the decision question from their own gut feeling, without
   being anchored to anything the agent produced.
3. **Only after that** do they see the bounded alternatives (dimensions plus
   compatibility), the trade-offs, the evidence, the missing evidence, and the
   accepted sacrifice (step 5). The live question comes last (step 6), and
   only when product authority is actually in play.

## Why the first reaction is weak by construction

If the decision is about a concrete layout or a visible interface, then
reacting to plain text — dimensions, trade-offs — with no representation at
all is a blind reaction. The user is being asked for an opinion about
abstractions, not about options.

The receipt does record `firstReaction`, but nothing guarantees that reaction
was informed. That is the finding: the field exists, the evidence behind it
does not.

## How the system handles this today

**The escape route exists.** The skill itself defines that insufficient
evidence routes to `research-needed`, and that a new scope boundary emits
`scope-map-challenge.json`. If the reaction needs a visual, the canonical path
is to leave the contrast and go to `interface-alternatives` → `int-gate` →
`selection` (Pattern 2, with an ASCII `preview` plus an `artifact`), where the
user compares wireframes side by side.

**But there is no automatic bridge.** The contrast does not reference the
proposals' wireframes as `artifact`/`preview` on the live question. The staging
artifact already flagged this as a possible hybrid that does not exist today.
Adding it would be a behaviour change, not current behaviour, and this card
does not make it.

## The honest reading

The contrast works well for **dimensional decisions** — "which work pattern
should this surface serve?", "which trade-off do we accept?" — where text is
enough.

For a **visible interface decision**, it depends on the user having already
seen the mockups in an earlier stage. If that did not happen, the preserved
first reaction is weak by construction, and the receipt records a reaction
nobody was in a position to form.

The gap worth registering: interface-contrast has no visual representation, and
it does not check whether the user has seen one before asking for the reaction.
