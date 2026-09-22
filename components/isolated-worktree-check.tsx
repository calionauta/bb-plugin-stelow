import { DetailsDisclosure } from "./disclosure";

// Single source for the isolated-worktree concept: same words in the
// import dialog, the card checkout note, and the publication panel —
// renaming the concept is one edit, never a hunt. Label names what it
// is (matching CHECKOUT_LABEL), the visible line names the benefit in
// plain words, technical detail lives behind progressive disclosure.
export const ISOLATED_WORKTREE_LABEL = "Isolated worktree";
export const ISOLATED_WORKTREE_BENEFIT = "The agent works on a separate copy — your files and branches stay untouched.";
const ISOLATED_WORKTREE_DETAILS = [
  "A managed git worktree on its own branch, created for this card and cleaned up after.",
  "Merging back stays yours: nothing lands in your checkout without review.",
  "Needs a New-worktree preset in Agent Presets — without one the card parks with an explanation instead of starting in your checkout.",
];

export function IsolatedWorktreeCheck({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-4 cursor-pointer" />
        <span className="font-medium">{ISOLATED_WORKTREE_LABEL}</span>
        <span className="text-muted-foreground">{ISOLATED_WORKTREE_BENEFIT}</span>
      </label>
      <DetailsDisclosure summary="How it works">
        <ul className="list-disc space-y-1 pl-5">
          {ISOLATED_WORKTREE_DETAILS.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </DetailsDisclosure>
    </div>
  );
}
