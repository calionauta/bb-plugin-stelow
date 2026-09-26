import { UrlLink } from "@get-bb/plugin-sdk/app";
import { isPathInstall, shortRef, updateComparison, type PluginUpdateVerdict } from "../../lib/plugin-update.mjs";
import { relativeTime } from "../../lib/relative-time.mjs";
import { Button } from "../ui/button";
import { UpdateBadge } from "./update-badge";

type GithubReleaseInfo = {
  tag: string;
  url: string;
  checkedAt: number;
  newer: boolean;
} | null;

function updateTitle(update: PluginUpdateVerdict, confirming: boolean): string {
  if (update.outcome === "update-available") {
    if (confirming) {
      const installed = shortRef(update.installed, update.installedDisplay) ?? "the installed version";
      const candidate = shortRef(update.candidate, update.candidateDisplay) ?? "the latest version";
      return `Update from ${installed} to ${candidate}?`;
    }
    const candidate = shortRef(update.candidate, update.candidateDisplay) ?? "a new version";
    return `Update available — ${candidate}`;
  }
  if (update.outcome === "current") return "Up to date";
  if (update.outcome === "checking") return "Checking BB for a compatible plugin update…";
  if (update.outcome === "pinned" || update.outcome === "incompatible") return "Not updated through BB";
  return "Update check unavailable";
}

function UpdateActions({ confirming, updating, onConfirm, onCancel, onApply }: {
  confirming: boolean;
  updating: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={updating} onClick={onApply}>
          {updating ? "Updating…" : "Confirm update"}
        </Button>
        <Button size="sm" variant="ghost" disabled={updating} onClick={onCancel}>Cancel</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        onClick={onConfirm}
        title="Apply the update and reload Stelow"
      >
        Update plugin…
      </Button>
    </div>
  );
}

function UnmanagedUpdateCopy({ version, update, github }: {
  version: string;
  update: PluginUpdateVerdict;
  github: GithubReleaseInfo;
}) {
  const unmanaged = update.outcome === "pinned"
    || update.outcome === "incompatible"
    || update.outcome === "unavailable";
  if (!unmanaged) return null;
  const pathInstall = isPathInstall(update.installedDisplay);
  // Both versions in one sentence: the running build next to the published
  // tag. Naming only the published one read as a claim about this install.
  const comparison = updateComparison(version, github);
  return (
    <>
      {update.detail ? <p>{update.detail}</p> : null}
      {!update.detail && pathInstall ? (
        <p>
          BB reports this install as not updatable through BB itself — local
          checkouts update with git pull, rebuild, and reload. “Check update”
          refreshes BB’s verdict and the GitHub release lookup together.
        </p>
      ) : null}
      {!update.detail && !pathInstall ? (
        <p>
          BB can’t apply an update to this install automatically right now. “Check update” re-checks; new releases appear here once BB can apply them.
        </p>
      ) : null}
      {comparison.published && comparison.state === "current" ? (
        <p>Running v{comparison.installed}, the latest release on GitHub — this checkout is current.</p>
      ) : null}
      {github?.newer ? (
        <p className="text-amber-700 dark:text-amber-300">
          Running v{comparison.installed};{" "}
          <UrlLink
            href={github.url}
            className="underline underline-offset-4 hover:text-foreground"
          >
            v{comparison.published} is published on GitHub ↗
          </UrlLink>
          {" "}{pathInstall
            ? "— pull the checkout, rebuild, and reload to run it."
            : "— it will be offered here once BB can apply it."}
        </p>
      ) : null}
    </>
  );
}

export function PluginUpdateStatus({ version, update, github, confirming, updating, checking, onCheck, onConfirm, onCancel, onApply }: {
  version: string;
  update: PluginUpdateVerdict;
  github: GithubReleaseInfo;
  confirming: boolean;
  updating: boolean;
  checking: boolean;
  onCheck: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const tone = update.outcome === "current"
    ? "text-emerald-500"
    : update.outcome === "update-available"
      ? "text-amber-500"
      : "text-muted-foreground/60";
  const available = update.outcome === "update-available";
  return (
    <div role="status" className="space-y-2 rounded-lg border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
      <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        {available ? <UpdateBadge label={null} /> : <span aria-hidden className={tone}>●</span>}
        {updateTitle(update, confirming)}
      </p>
      {available ? (
        <>
          <UpdateActions
            confirming={confirming}
            updating={updating}
            onConfirm={onConfirm}
            onCancel={onCancel}
            onApply={onApply}
          />
          <p>Stelow reloads afterwards.</p>
          {update.detail ? <p>{update.detail} — showing the last known verdict; Check update retries.</p> : null}
        </>
      ) : null}
      <UnmanagedUpdateCopy version={version} update={update} github={github} />
      {update.outcome === "checking" ? null : (
        <p>
          {update.checkedAt ? `Last checked ${relativeTime(update.checkedAt)} · ` : null}
          <button
            type="button"
            onClick={onCheck}
            disabled={checking}
            className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-foreground disabled:cursor-default disabled:opacity-60"
          >
            {checking ? "Checking…" : "Check update"}
          </button>
        </p>
      )}
    </div>
  );
}
