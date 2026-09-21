import { BUILD_BOARD_COLUMN_LABELS, BUILD_BOARD_INBOX } from "../lib/workflow-vocabulary.mjs";
import { Icon } from "@/components/ui/icon";

export function StartImmediatelyCheck({ checked, onChange, onViewBucket }: { checked: boolean; onChange: (next: boolean) => void; onViewBucket?: (() => void) | null }) {
  // The word rides the board label map, never a pasted string — renaming
  // the concept again is one line in lib/workflow-vocabulary.mjs.
  const bucket = BUILD_BOARD_COLUMN_LABELS[BUILD_BOARD_INBOX] ?? "Bucket";
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-4 cursor-pointer" />
      <span className="font-medium">Start immediately</span>
      <span className="text-xs text-muted-foreground">— uncheck to park in{" "}
        {onViewBucket ? (
          <button type="button" onClick={(event) => { event.preventDefault(); onViewBucket(); }} title={`View the ${bucket}`} className="inline-flex cursor-pointer items-center gap-1 font-medium text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            <Icon name="PackageReceive" className="h-3.5 w-3.5" aria-hidden />{bucket}
          </button>
        ) : (
          <span className="font-medium text-foreground">{bucket}</span>
        )}{" "}
        and start later.</span>
    </label>
  );
}
