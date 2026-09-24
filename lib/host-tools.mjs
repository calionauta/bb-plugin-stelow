const HOST_TOOL_IDS = ["ast-grep", "cymbal", "ripwire", "sem"];

function isHostToolId(id) {
  return HOST_TOOL_IDS.includes(id);
}

function toolErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" && error.trim() ? error : "Install failed.";
}

export function beginToolInstall(errors, id) {
  if (!(id in errors)) return errors;
  const next = { ...errors };
  delete next[id];
  return next;
}

export function finishToolInstall(errors, id, error) {
  if (!isHostToolId(id)) return errors;
  return { ...errors, [id]: toolErrorMessage(error) };
}

export function clearToolError(errors, id) {
  return beginToolInstall(errors, id);
}

export function mergeToolStatuses(previous, next) {
  if (!Array.isArray(next)) return previous;
  const valid = next.filter((tool) => (
    tool !== null
    && typeof tool === "object"
    && isHostToolId(tool.id)
    && typeof tool.present === "boolean"
    && (tool.version === null || typeof tool.version === "string")
  ));
  return valid.length > 0 ? valid : previous;
}
