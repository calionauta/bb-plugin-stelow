export function StartImmediatelyCheck({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-4 cursor-pointer" />
      <span className="font-medium">Start immediately</span>
      <span className="text-xs text-muted-foreground">— uncheck to park in Inbox and start later.</span>
    </label>
  );
}
