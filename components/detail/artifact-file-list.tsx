import { Button } from "@/components/ui/button";
import type { SiblingFile } from "./use-artifact-navigation";

/**
 * The files beside the one being read, as navigation rather than a second list
 * on the card. The current file stays in the set and is marked, so the reader
 * always sees the whole stage in one glance; Back returns to the document they
 * came from, including one reached by a link rather than by this row.
 */
export function ArtifactFileList({ files, currentPath, canGoBack, onOpen, onBack }: {
  files: SiblingFile[];
  currentPath: string;
  canGoBack: boolean;
  onOpen: (file: SiblingFile) => void;
  onBack: () => void;
}) {
  if (!canGoBack && files.length <= 1) return null;
  return (
    <nav aria-label="Files in this folder" className="flex flex-wrap items-center gap-1">
      {canGoBack ? (
        <Button type="button" variant="ghost" size="sm" onClick={onBack} className="min-h-11 cursor-pointer">
          ← Back
        </Button>
      ) : null}
      {files.map((file) => {
        const active = file.absolutePath === currentPath || file.path === currentPath;
        return (
          <Button
            key={file.absolutePath}
            type="button"
            variant={active ? "secondary" : "outline"}
            size="sm"
            aria-current={active ? "page" : undefined}
            title={file.path}
            onClick={() => onOpen(file)}
            className="min-h-11 max-w-[16rem] cursor-pointer"
          >
            <span className="truncate">{file.name}</span>
          </Button>
        );
      })}
    </nav>
  );
}
