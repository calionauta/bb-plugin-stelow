# Interface proposal — Lean

## Proposal A — Attention-first segmented filter

### Work Pattern
The user arrives to clear pending work, not browse a feed. The first visible state must therefore contain only unread events that need a human response.

### Layout
A compact, responsive segmented control immediately below the Inbox header:

```
Inbox                                      
Work that needs you.                         

[ Unread (2) ] [ Resolved automatically ] [ Archived ] [ All ]

Needs your attention
┌ ?  Card name · unread
│    The agent is waiting for your answer to continue.
│    Project · 5m ago                              Archive
└─────────────────────────────────────────────────────────────
```

The selected filter controls one chronological list. On narrow screens the control scrolls horizontally rather than wrapping unpredictably. Buttons have 44px targets, keyboard focus, and `aria-pressed`.

### Interaction flow
1. Inbox opens in Unread.
2. Select a filter; list updates locally with no reload.
3. Open an event to navigate to its card and mark it read.
4. Archive/restore remains a row action.

### Copy
- **Unread:** “Work that needs your attention.”
- **Resolved automatically:** “No longer needs attention. History is kept here.”
- **Archived:** “Archived updates. Restore an item to return it to history.”
- **All:** “All active Inbox updates, newest first.”

“Resolved automatically” is a requested category name; the supporting copy avoids claiming every question was answered by automation.

### Trade-offs
A filter replaces the previous separate sections and hidden details history. This is easier to scan and preserves one clear main action, at the cost of one click to see completion updates.

### Design smell audit
- No competing primary controls.
- No state hidden in a disclosure.
- Semantic buttons, visible focus rings, cursor pointers, and minimum 44px targets.

### State coverage
| State | Behavior |
|---|---|
| Loading | Existing compact skeleton |
| Empty Unread | “All clear — Stelow will surface work only when it needs you.” |
| Empty history filter | Filter-specific empty message |
| Error | Existing retry panel |
| Long filters | Horizontal scrolling control |
