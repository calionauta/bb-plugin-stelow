export function TrackSkeleton({ columns = 5 }: { columns?: number }) {
  return (
    <div className="space-y-4" aria-label="Loading" aria-busy="true">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="h-5 w-72 animate-pulse rounded bg-muted/50" />
          <div className="h-7 w-28 animate-pulse rounded bg-muted/50" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <div className="h-11 w-28 animate-pulse rounded-md bg-muted/50" />
          <div className="h-11 w-24 animate-pulse rounded-md bg-muted/50" />
        </div>
      </header>
      <div className="h-11 animate-pulse rounded-md border bg-muted/30" />
      <div className="flex items-center gap-2 border-b pb-3">
        <div className="h-9 flex-1 animate-pulse rounded-md bg-muted/50" />
        <div className="h-9 w-20 animate-pulse rounded-md bg-muted/50" />
      </div>
      <div className="grid gap-3 lg:grid-cols-5">
        {Array.from({ length: columns }, (_, index) => (
          <section key={index} className="min-h-40 rounded-md border bg-muted/20 p-3">
            <div className="h-4 w-20 animate-pulse rounded bg-muted/50" />
            <div className="mt-3 h-20 animate-pulse rounded-md bg-muted/50" />
          </section>
        ))}
      </div>
    </div>
  );
}
