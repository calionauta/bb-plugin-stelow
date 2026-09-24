import { DisclosureSection } from "../disclosure";
import { artifactFilename, fileLinkTarget, type HostFileTarget, type WorkspaceFileTarget } from "../artifacts/artifact-inventory";

// Input files: attachments from card creation. Openable files (host id +
// absolute path) render as viewer buttons through the shared file-target
// convention; the rest render as plain rows — never a dead button.

export type InputAttachment = {
  display: string;
  path: string;
  relPath?: string | null;
  hostId?: string | null;
  absolutePath: string;
  type: string;
};

export type InputFilesDetail = {
  attachments: InputAttachment[];
  fileEnvironmentId: string | null;
} | null;

export function InputFiles({ card, detail, onView }: {
  card: { workspaceKind: string };
  detail: InputFilesDetail;
  onView: (file: { display: string; path: string; target: WorkspaceFileTarget | HostFileTarget | null }) => void;
}) {
  const files = detail?.attachments ?? [];
  if (files.length === 0) return null;
  return (
    <DisclosureSection title="Input files" hint={`${files.length} file${files.length === 1 ? "" : "s"}`} defaultOpen>
      <p className="text-xs text-muted-foreground">Files attached when this card was started.</p>
      <div className="mt-2 divide-y divide-border rounded-md border">
        {files.map((file) => {
          const canOpen = Boolean(file.hostId && file.absolutePath);
          const body = <>
            <span className="mt-0.5" aria-hidden>{file.type === "localImage" ? "🖼️" : "📎"}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-foreground">{file.display}</span>
              <span className="block truncate text-muted-foreground">File: {artifactFilename(file.path)}</span>
            </span>
            {canOpen ? <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden>↗</span> : null}
          </>;
          return canOpen ? (
            <button
              key={`${file.type}:${file.path}`}
              onClick={() => onView({ display: file.display, path: file.absolutePath, target: fileLinkTarget(card.workspaceKind === "exploratory", detail?.fileEnvironmentId ?? null, file.relPath ?? file.path, file.hostId!, file.absolutePath) })}
              className="flex min-h-11 w-full cursor-pointer items-start gap-2 px-2 py-2 text-left text-xs hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              title={`Open ${file.display}`}
            >
              {body}
            </button>
          ) : <div key={`${file.type}:${file.path}`} className="flex min-h-11 items-start gap-2 px-2 py-2 text-xs">{body}</div>;
        })}
      </div>
    </DisclosureSection>
  );
}
