import { DisclosureSection } from "../disclosure";

// Who else holds this card's files, asked on purpose. The lines are derived
// server-side from the claim ledger the lock protocol already enforces, so this
// renders and decides nothing: it shows the state BEFORE a collision, which is
// the one thing the lock wall cannot say.
//
// Closed by default, like every section that is not `live` or `blocking`. An
// empty answer renders nothing at all rather than an empty box — and under a
// managed worktree the server says `isolated`, because isolation is the reason
// there is nothing to report, and hiding that reason would read as a scan that
// found nobody.
export type FileOccupancyView = {
  isolated: boolean;
  lines: string[];
  shared: number;
};

export function FileOccupancy({ occupancy }: { occupancy: FileOccupancyView }) {
  if (occupancy.isolated) return null;
  if (occupancy.lines.length === 0) return null;
  return (
    <DisclosureSection
      title="Shared files"
      hint={`${occupancy.shared} ${occupancy.shared === 1 ? "file" : "files"} another card also holds`}
    >
      <ul className="space-y-1">
        {occupancy.lines.map((line) => (
          <li key={line} className="text-xs text-muted-foreground">{line}</li>
        ))}
      </ul>
    </DisclosureSection>
  );
}
