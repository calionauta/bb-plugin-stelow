# Critique report — Inbox filters

## Result
Approved with Auto-mode defaults applied. The proposal is implementable with the existing event lifecycle and requires no schema change.

## Findings and resolutions

### 🔎 Flows and states
**Gap:** “Unread” could include unseen completions.

**Resolution:** Define Unread as unread, unresolved action kinds only (`question`, `error`, `paused`). Completions are informational and appear only in All.

### 🔎 Data and system
**Gap:** The requested “Resolved Automatically” label could falsely say that a user did not answer a question.

**Resolution:** Retain the requested filter name for discoverability, but make its explanation say “No longer needs attention.” Preserve original summaries in rows. The filter is a lifecycle/history view, not evidence that every resolution was machine-only.

### 🔎 Affordance and design quality
**Gap:** Four views can become a large control at narrow widths.

**Resolution:** Use a compact segmented filter with full button labels, horizontal scrolling if necessary, `aria-pressed`, focus rings, 44px hit targets, and counts only where useful.

### 🔎 Compositional quality
**Gap:** Separate sections obscure chronology and force users to discover history through a details element.

**Resolution:** Each selected filter renders a chronological list with one clear title and an explicit empty state.

### 🔎 Feasibility
**Gap:** Filtered archived data is unavailable when the existing toggle is off.

**Resolution:** Always request the current 200-event durable window with `includeArchived: true`; the existing server API already supports this. No new endpoint or migration is necessary.

## Auto-mode decision
Proceed with the four filter choices and precise lifecycle wording. No human question is required because the existing behavior establishes the facts: resolved is real lifecycle state, but is not always automatic resolution in the human sense.
