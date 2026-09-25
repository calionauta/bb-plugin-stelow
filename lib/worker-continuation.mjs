export function buildContinueNudge(INTERFACE_PICK) {
  return `Continue the Stelow workflow now from the current stage. Re-read your state.md and transitions.md first, then keep working. Only \
a visible structured form on the card counts as a pending question — a prior chat message or split-proposal record does not. If the user cannot \
see a form and the stage needs input, submit the same bb stelow ask once; the host refuses duplicates when a real form is open. Never claim to \
be waiting based on memory alone. ${INTERFACE_PICK} Unselected gates approve and advance themselves; selected gates use a structured ask. If \
a bb stelow command fails, read its stderr once and continue — do not spend the turn debugging the CLI.`;
}

export function buildContinueInput(text, visibility = "public") {
  const input = {
    type: "text",
    text,
    mentions: [],
  };
  if (visibility === "private") input.visibility = "agent-only";
  return [input];
}

export function autoContinueFields(next, lastOutput) {
  const fields = {
    activity: "running",
    last_idle_at: null,
    last_error: null,
    auto_continue_count: next.count,
    auto_continue_stage: next.stage,
  };
  if (lastOutput != null) fields.last_assistant_text = lastOutput;
  return fields;
}
