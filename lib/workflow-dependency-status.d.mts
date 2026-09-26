export type WorkflowDependencyStatus = {
  id: "workflows";
  name: "BB Workflows";
  installed: boolean;
  enabled: boolean;
  running: boolean;
  available: boolean;
  version: string | null;
  action: "install" | "enable" | null;
  detail: string;
};

export function workflowsUnreadable(detail?: string): WorkflowDependencyStatus;
export function workflowsDependencyStatus(stdout: string): WorkflowDependencyStatus;
