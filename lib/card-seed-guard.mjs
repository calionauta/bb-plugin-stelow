// Card workers must never seed: their workflow is pre-seeded at spawn with
// the card id as the immutable owner. A `bb stelow seed` from inside a card
// thread mints a name-derived owner at the project root — an orphan state
// dir no card resolves back (the card keeps reading its own state dir while
// the worker advances a ghost workflow). The seed CLI therefore refuses card
// workers; the refusal names the card's own state dir as the valid redirect
// (a refusal without an exit is a deadlock with a good error message).
export function cardWorkerSeedRefusal({ cardName, stateDirText }) {
  const where = stateDirText
    ? `Your workflow is already seeded at ${stateDirText}`
    : `Your card workflow is already seeded`;
  const what = cardName ? ` for card "${cardName}"` : "";
  return `Refused: card workers never run \`bb stelow seed\`. ${where}${what} — keep working in it. Seeding here would create a second, ownerless workflow at the project root that no card can resolve back. If your own state dir is missing or unreadable, report it and stop instead of seeding.`;
}
