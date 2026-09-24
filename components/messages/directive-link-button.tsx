import { useEffect, useState } from "react";
import { attemptWorkspaceFileOpen, type WorkspaceLinkState } from "../../lib/message-directives.mjs";

type DirectiveLinkButtonProps = {
  children: React.ReactNode;
  className: string;
  label: string;
  openWorkspaceFile: ((path: string) => boolean) | null;
  path: string;
  title: string;
  tone: string;
};

function unavailableLabel(label: string, state: WorkspaceLinkState): string | null {
  if (state === "dead") return `${label} unavailable`;
  if (state === "failed") return `${label} could not open`;
  return null;
}

export function DirectiveLinkButton({
  children,
  className,
  label,
  openWorkspaceFile,
  path,
  title,
  tone,
}: DirectiveLinkButtonProps) {
  const [state, setState] = useState<WorkspaceLinkState>("unavailable");
  useEffect(() => {
    setState("unavailable");
  }, [openWorkspaceFile, path]);
  const unavailable = unavailableLabel(label, state);
  const blocked = !openWorkspaceFile || unavailable !== null;
  const openFile = () => {
    setState(attemptWorkspaceFileOpen(openWorkspaceFile, path));
  };
  return (
    <button
      type="button"
      onClick={openFile}
      disabled={blocked}
      className={`${className} ${tone}`}
      title={unavailable ? `${title} — link is unavailable` : title}
    >
      {unavailable ?? children}
    </button>
  );
}

export function InvalidDirective({ source }: { source: string }) {
  return <span className="text-sm text-destructive">{source}</span>;
}
