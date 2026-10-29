import { Button } from "@/components/ui/button";
import type { SiblingFile } from "./use-artifact-navigation";

/**
 * The documents beside the one being read, as a file switcher rather than a
 * row of tags.
 *
 * The reader needs to know two things at a glance: which document is on screen,
 * and that the folder holds others worth comparing. A bare row of chip-like
 * buttons answered neither — it looked like metadata, and on a real card a
 * wrong path made each click open another list instead of the text. So the
 * group is labelled, the current file carries `aria-current` and a filled mark,
 * and the count says there is more than one. Back is part of the same group
 * because it is the same job: move between the documents already read.
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
    <nav aria-label="Related files in this folder" className="rounded-md border bg-muted/20 px-2 py-1">
      <div className="flex min-h-9 items-center gap-2">
        {canGoBack ? (
          <Button type="button" variant="ghost" size="sm" onClick={onBack} className="min-h-11 cursor-pointer">
            ← Back
          </Button>
        ) : null}
        <span className="text-xs font-medium text-muted-foreground">Related files</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {files.length} in this folder
        </span>
      </div>
      <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto pb-1">
        {files.map((file) => {
          const active = file.absolutePath === currentPath || file.path === currentPath;
          return (
            <Button
              key={file.absolutePath}
              type="button"
              variant={active ? "secondary" : "ghost"}
              size="sm"
              aria-current={active ? "page" : undefined}
              title={file.path}
              onClick={() => onOpen(file)}
              className="min-h-11 max-w-[16rem] cursor-pointer justify-start gap-1.5"
            >
              <span aria-hidden className="text-muted-foreground">{active ? "▣" : "▤"}</span>
              <span className="truncate">{file.name}</span>
            </Button>
          );
        })}
      </div>
      <p className="pb-1 text-xs text-muted-foreground">
        This folder holds {files.length === 1 ? "one document" : `${files.length} documents`}; open another to compare.
      </p>
    </nav>
  );
}
