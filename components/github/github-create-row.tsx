export function GithubCreateRow({ repos, checked, onCheckedChange, repo, onRepoChange }: {
  repos: string[];
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  repo: string | null;
  onRepoChange: (next: string | null) => void;
}) {
  if (repos.length === 0) return null;
  const selected = repo ?? repos[0] ?? null;
  return (
    <div className="space-y-1">
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} className="size-4 accent-primary" />
        Also create issue{repos.length === 1 ? ` in ${repos[0]}` : " in the project repo"}
      </label>
      {repos.length > 1 ? (
        <select value={selected ?? ""} onChange={(event) => onRepoChange(event.target.value || null)} className="h-10 cursor-pointer rounded-md border bg-background px-2 text-sm" aria-label="GitHub repository for the new issue">
          <option value="">Pick a repository</option>
          {repos.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      ) : null}
      <p className="text-xs text-muted-foreground">Card is created first; on failure the card stands and the error names the cause.</p>
    </div>
  );
}
