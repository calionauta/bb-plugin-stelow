import {
  experimental_NewThreadComposer as NewThreadComposer,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk/app";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreateCardAlert } from "./creation-settings";
import type { ComposerEnvironmentSeed } from "./composer-environment-seed";

export type CardAttachment = { type: "localFile" | "localImage"; path: string };

// Composer request split: the text is the submission, local files and
// images are attachments. A path printed in a prompt is not an attachment,
// so BB cannot render or open it in the worker thread.
export function submissionOf(request: NewThreadRequest) {
  const textPart = request.input.find((part) => part.type === "text");
  const submission = textPart && "text" in textPart ? (textPart as { text: string }).text.trim() : "";
  type AttachmentPart = { type: "localFile" | "localImage"; path: string };
  const isAttachment = (part: unknown): part is AttachmentPart =>
    (part as AttachmentPart).type === "localFile" || (part as AttachmentPart).type === "localImage";
  const hasPath = (part: AttachmentPart): boolean =>
    "path" in part && typeof part.path === "string" && part.path.length > 0;
  const attachments = request.input
    .filter((part): part is AttachmentPart => isAttachment(part) && hasPath(part))
    .map((part) => ({ type: part.type, path: part.path }));
  return { submission, attachments };
}

export type CardPreset = {
  providerId: string;
  modelId: string;
  reasoningLevel: string;
  permissionMode: string;
  environmentKind: string;
  name: string;
} | null;

// One composer for every creation dialog — build, research, explore differ
// only in placeholder and draft key, never in wiring.
export function CreateCardComposer({ seedProjectId, preset, seededEnvironment, prompt, placeholder, draftKey, onSubmit }: {
  seedProjectId: string | null;
  preset: CardPreset;
  seededEnvironment: ComposerEnvironmentSeed;
  prompt: string;
  placeholder: string;
  draftKey: string;
  onSubmit: (request: NewThreadRequest) => Promise<void>;
}) {
  return (
    <NewThreadComposer
      defaultProjectId={seedProjectId ?? undefined}
      defaultProviderId={preset?.providerId}
      defaultModel={preset?.modelId}
      defaultReasoningLevel={preset?.reasoningLevel as NewThreadRequest["reasoningLevel"] | undefined}
      defaultPermissionMode={preset?.permissionMode as NewThreadRequest["permissionMode"] | undefined}
      defaultEnvironment={seededEnvironment}
      initialPrompt={prompt}
      placeholder={placeholder}
      layout="contained"
      draftKey={draftKey}
      onSubmit={onSubmit}
    />
  );
}

// One dialog shell for every creation dialog: header plus the shared error
// alert, so the title/description are the only per-track words here.
export function CreateCardDialogShell({ open, onOpenChange, title, description, error, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent fullscreenOnMobile className="overflow-y-auto overflow-x-hidden sm:max-h-[calc(100dvh-1rem)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error ? <CreateCardAlert message={error} /> : null}
        {children}
      </DialogContent>
    </Dialog>
  );
}
