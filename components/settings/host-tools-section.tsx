import { useState } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import { HOST_TOOLS, missingToolIds } from "../../lib/host-tools.mjs";
import type { HostToolId, HostToolMeta, HostToolStatus } from "../../lib/host-tools.mjs";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { DisclosureChevron, SECTION_SURFACE, SUMMARY_ROW } from "../disclosure";
import { Icon } from "../ui/icon";

const NPX_TOOLS = [
  {
    name: "npx skills",
    repo: "https://github.com/vercel-labs/skills",
    plain: "The skills hub workers use to fetch playbooks and stack-matched skills on demand.",
    tech: "Ships with Node.js; invoked per use, never installed globally by the plugin.",
  },
  {
    name: "ctx7",
    repo: "https://github.com/upstash/context7",
    plain: "Current, version-specific library docs while writing code — never for choosing the stack.",
    tech: "Auto-installs on first npx invocation; guided OAuth setup (terminal) only raises limits.",
  },
  {
    name: "last30days",
    repo: "https://github.com/mvanhorn/last30days-skill",
    plain: "Social recency signal for market research — complementary source only.",
    tech: "Agent skill, not a binary; workers add it per use, only with your confirmation.",
  },
  {
    name: "agent-reach",
    repo: "https://github.com/Panniantong/agent-reach",
    plain: "Fetch router for platform evidence (incl. Bilibili/Xiaohongshu) — fetch only, never synthesis.",
    tech: [
      "Agent skill + local CLIs; workers add it per use, only with your confirmation.",
      "Login channels need your browser session or cookies — use a secondary account,",
      "never the primary.",
    ].join(" "),
  },
  {
    name: "thermo-nuclear",
    repo: "https://github.com/cursor/plugins/tree/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review",
    plain: "Optional ultra-strict final code review, gated by quality and risk.",
    tech: "Agent skill from the cursor/plugins hub package; documented manual checks apply when absent.",
  },
];

function InstallError({ message }: { message: string }) {
  const summary = message.split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 220)
    ?? "unknown error";
  return (
    <div className="mt-1.5 space-y-1">
      <p className="text-[11px] text-destructive">Install failed: {summary}</p>
      <details className="group">
        <summary className={cn(SUMMARY_ROW, "text-[11px] text-muted-foreground hover:text-foreground")}>
          <DisclosureChevron />
          Install log
        </summary>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-background/60 p-2 font-mono text-[11px] leading-relaxed">
          {message}
        </pre>
      </details>
    </div>
  );
}

function HostToolCard({ meta, status, installing, disabled, error, onInstall }: {
  meta: HostToolMeta;
  status?: HostToolStatus;
  installing: boolean;
  disabled: boolean;
  error?: string;
  onInstall: (id: HostToolId) => void;
}) {
  const present = status?.present === true;
  return (
    <div className={`${SECTION_SURFACE} p-3`}>
      <HostToolHeader
        meta={meta}
        present={present}
        version={present ? (status?.version ?? "installed") : "not installed"}
        installing={installing}
        disabled={disabled}
        onInstall={onInstall}
      />
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{meta.plain}</p>
      <p className="mt-0.5 font-mono text-[11px] leading-5 text-muted-foreground/80">{meta.tech}</p>
      <HostToolFoot
        present={present}
        installing={installing}
        install={meta.install}
        error={error}
      />
    </div>
  );
}

/** One tool's identity and its single action, on one line. */
function HostToolHeader({ meta, present, version, installing, disabled, onInstall }: {
  meta: HostToolMeta;
  present: boolean;
  version: string;
  installing: boolean;
  disabled: boolean;
  onInstall: (id: HostToolId) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className={present ? "text-emerald-500" : "text-muted-foreground/50"}>
        {present ? "●" : "○"}
      </span>
      <span className="font-mono text-xs font-semibold text-foreground">{meta.name}</span>
      <UrlLink
        href={meta.repo}
        title={`${meta.name} repository`}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:border-primary/50 hover:text-foreground"
      >
        <Icon name="Github" className="h-3.5 w-3.5" aria-hidden />
      </UrlLink>
      <span className="text-[11px] text-muted-foreground">{version}</span>
      <span className="ml-auto">
        <Button
          size="sm"
          variant={present ? "ghost" : "outline"}
          disabled={disabled}
          onClick={() => onInstall(meta.id)}
          title={present ? `Reinstall ${meta.name} at its latest release` : `Install ${meta.name} now`}
        >
          {installing ? (present ? "Updating…" : "Installing…") : (present ? "Update" : "Install")}
        </Button>
      </span>
    </div>
  );
}

/** What a tool needs before, during and after an install. */
function HostToolFoot({ present, installing, install, error }: {
  present: boolean;
  installing: boolean;
  install: string;
  error?: string;
}) {
  return (
    <>
      {!present && !installing ? (
        <pre className="mt-1.5 overflow-x-auto rounded-md border bg-background/60 p-2 font-mono text-[11px] leading-relaxed">
          {install}
        </pre>
      ) : null}
      {installing ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Installing — can take a couple minutes. The row flips to ● on success.
        </p>
      ) : null}
      {error ? <InstallError message={error} /> : null}
    </>
  );
}

function NpxTools() {
  return (
    <>
      <h3 className="pt-2 text-sm font-semibold text-foreground">Ready via npx — no install needed</h3>
      <p className="text-xs leading-5 text-muted-foreground">
        You never run anything below — workers resolve these automatically when a step needs them. Listed so every dependency Stelow touches is visible.
      </p>
      <div className="space-y-2">
        {NPX_TOOLS.map((meta) => (
          <div key={meta.name} className="rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-foreground">{meta.name}</span>
              {meta.repo ? (
                <UrlLink
                  href={meta.repo}
                  title={`${meta.name} repository`}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:border-primary/50 hover:text-foreground"
                >
                  <Icon name="Github" className="h-3.5 w-3.5" aria-hidden />
                </UrlLink>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{meta.plain}</p>
            <p className="mt-0.5 font-mono text-[11px] leading-5 text-muted-foreground/80">{meta.tech}</p>
          </div>
        ))}
      </div>
    </>
  );
}

function InstallAllRow({ missing, busy, onInstallAll }: {
  missing: HostToolId[];
  busy: boolean;
  onInstallAll: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => { setConfirming(false); onInstallAll(); }}
            title={`Install ${missing.length} missing tool${missing.length === 1 ? "" : "s"} now`}
          >
            {busy ? "Installing…" : `Confirm install (${missing.length})`}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => setConfirming(true)}
          title="Install every missing tool in panel order"
        >
          Install all missing ({missing.length})
        </Button>
      )}
    </div>
  );
}

export function HostToolsSection({ tools, onInstall, onInstallAll, installingId, errors }: {
  tools: HostToolStatus[] | null;
  onInstall: (id: HostToolId) => void;
  onInstallAll?: () => void;
  installingId: string | null;
  errors: Record<string, string>;
}) {
  const byId = new Map((tools ?? []).map((tool) => [tool.id, tool]));
  const missing = tools ? missingToolIds(tools) : [];
  const busy = installingId !== null;
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-foreground">Optional tools</h2>
      <p className="text-sm leading-6 text-muted-foreground">
        Recommended by Stelow, honored here. Workers use these tools when present;
        without one, the same step still works with the built-in fallback — just
        with less depth. Install anytime; effects apply on next use.{" "}
        <UrlLink
          href="https://github.com/calionauta/stelow#external-dependencies"
          className="underline underline-offset-4 hover:text-foreground"
        >
          Learn more ↗
        </UrlLink>
      </p>
      {!tools ? (
        <p className="text-xs text-muted-foreground">Checking host tools…</p>
      ) : (
        <div className="space-y-2">
          {onInstallAll && missing.length > 0 ? (
            <InstallAllRow missing={missing} busy={busy} onInstallAll={onInstallAll} />
          ) : null}
          {HOST_TOOLS.map((meta) => (
            <HostToolCard
              key={meta.id}
              meta={meta}
              status={byId.get(meta.id)}
              installing={installingId === meta.id}
              disabled={installingId !== null}
              error={errors[meta.id]}
              onInstall={onInstall}
            />
          ))}
        </div>
      )}
      <NpxTools />
    </section>
  );
}
