import { useState } from "react";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { browserStorage, readLastProjectId, rememberUsedProject, resolveDefaultProjectId } from "../../lib/last-project.mjs";

// Per-open project seed shared by the build, research, and explore creation
// dialogs. The user's last pick (when still valid) wins over the ambient host
// context. Resolved once per open — the SDK re-seeds every execution selection
// when default* props change after mount, so the seed must not flap while the
// dialog is open. A submit that throws (or never fires) remembers nothing.
export function useProjectSeed({ activeProjectId, validProjectIds }: {
  activeProjectId: string | null;
  validProjectIds?: string[];
}) {
  const [seedProjectId, setSeedProjectId] = useState<string | null>(activeProjectId);
  function reseedOnOpen() {
    setSeedProjectId(resolveDefaultProjectId(activeProjectId, readLastProjectId(browserStorage()), validProjectIds));
  }
  // Shared open handler: every open resets the dialog to started with a clean
  // error (via reset) and reseeds the project from the user's last pick.
  function openChange(next: boolean, onOpenChange: (open: boolean) => void, reset: () => void) {
    onOpenChange(next);
    if (next) {
      reset();
      reseedOnOpen();
    }
  }
  function submitWithMemory(request: NewThreadRequest, start: (request: NewThreadRequest) => Promise<unknown>): Promise<void> {
    return start(request).then(() => {
      rememberUsedProject(browserStorage(), request.projectId ?? seedProjectId);
    });
  }
  return { seedProjectId, openChange, submitWithMemory };
}
