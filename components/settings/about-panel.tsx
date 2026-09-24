import { useEffect, useState } from "react";
import { UrlLink, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { resetOnboarding } from "../../lib/preset-onboarding-state.mjs";
import { updateAvailableFrom, type BuildInfo } from "../../lib/plugin-update.mjs";
import { setPluginUpdateAvailable } from "../../lib/plugin-update-signal.mjs";
import {
  beginToolInstall,
  finishToolInstall,
  mergeToolStatuses,
  type HostToolId,
  type HostToolStatus,
} from "../../lib/host-tools.mjs";
import type { rpcContract } from "../../server";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Icon } from "../ui/icon";
import { HostToolsSection } from "./host-tools-section";
import { usePluginUpdateActions } from "./plugin-update-actions";
import { PluginUpdateStatus } from "./plugin-update-status";
import { UpdateBadge } from "./update-badge";
import { WorkflowDependencyCard } from "./workflow-dependency-card";

function useHostToolState() {
  const rpc = useRpc<typeof rpcContract>();
  const [tools, setTools] = useState<HostToolStatus[] | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function install(id: HostToolId) {
    setInstallingId(id);
    setErrors((previous) => beginToolInstall(previous, id));
    void rpc.call("installTool", { id }).then((result) => {
      if (!result.ok) {
        setErrors((previous) => finishToolInstall(previous, id, result.log || "Install failed."));
        return;
      }
      void rpc.call("toolStatus", {}).then((result) => {
        setTools((previous) => mergeToolStatuses(previous, result.tools));
      }).catch(() => undefined);
    }).catch((error) => {
      setErrors((previous) => finishToolInstall(previous, id, error));
    }).finally(() => setInstallingId(null));
  }

  useEffect(() => {
    let cancelled = false;
    void rpc.call("toolStatus", {}).then((result) => {
      if (!cancelled) setTools(mergeToolStatuses(null, result.tools));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [rpc]);

  return { tools, installingId, errors, install };
}

function useAboutData() {
  const rpc = useRpc<typeof rpcContract>();
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  const [aboutLogo, setAboutLogo] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void rpc.call("buildInfo", {}).then((result) => {
      if (cancelled) return;
      setBuildInfo(result);
      setPluginUpdateAvailable(updateAvailableFrom(result));
    }).catch(() => undefined);
    void rpc.call("aboutLogo", {}).then((result) => {
      if (!cancelled && result.dataUri) setAboutLogo(result.dataUri);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [rpc]);
  return { buildInfo, setBuildInfo, aboutLogo };
}

function AboutHeading({ buildInfo, aboutLogo }: { buildInfo: BuildInfo | null; aboutLogo: string | null }) {
  return (
    <>
      <header>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold tracking-tight">About</h1>
          {buildInfo && updateAvailableFrom(buildInfo) ? <UpdateBadge /> : null}
        </div>
      </header>
      <section className="space-y-2">
        {aboutLogo ? (
          <div className="flex justify-center py-1">
            <img
              src={aboutLogo}
              alt="Stelow — Your Product Team"
              className="w-56 max-w-full object-contain sm:w-64"
            />
          </div>
        ) : null}
        <h2 className="text-base font-semibold text-foreground">
          Stelow {buildInfo?.stelowVersion ? (
            <span className="text-[11px] font-normal text-muted-foreground">
              v{buildInfo.stelowVersion}
            </span>
          ) : null}
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Stelow helps humans and AI agents operate as a cross-functional product team, not just coding assistants, through a structured product workflow.
        </p>
        <RepoLink href="https://github.com/calionauta/stelow">Stelow repo</RepoLink>
      </section>
    </>
  );
}

function RepoLink({ href, children }: { href: string; children: string }) {
  return (
    <UrlLink
      href={href}
      className={[
        "inline-flex h-8 cursor-pointer items-center justify-center gap-2",
        "whitespace-nowrap rounded-md border bg-card px-3 text-xs font-medium shadow-sm",
        "hover:border-primary/50",
      ].join(" ")}
    >
      <Icon name="Github" className="h-3.5 w-3.5" aria-hidden />
      {children} <span aria-hidden="true">↗</span>
    </UrlLink>
  );
}

type PluginUpdateActions = ReturnType<typeof usePluginUpdateActions>;

function UpdateCard({ buildInfo, actions }: {
  buildInfo: BuildInfo | null;
  actions: PluginUpdateActions;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <h3 className="text-sm font-semibold text-foreground">Status</h3>
      {buildInfo ? (
        <div className="mt-2">
          <PluginUpdateStatus
            version={buildInfo.version}
            update={buildInfo.pluginUpdate}
            github={buildInfo.githubRelease}
            confirming={actions.confirming}
            updating={actions.updating}
            checking={actions.checking}
            onCheck={actions.recheck}
            onConfirm={() => actions.setConfirming(true)}
            onCancel={() => actions.setConfirming(false)}
            onApply={actions.apply}
          />
          {actions.error ? <p className="mt-2 text-xs text-destructive" role="alert">{actions.error}</p> : null}
          {actions.notice ? <p className="mt-2 text-xs text-primary" role="status">{actions.notice}</p> : null}
        </div>
      ) : <p className="mt-1 text-xs text-muted-foreground">Checking status…</p>}
    </div>
  );
}

function PluginSummary({ buildInfo, onOpenSkills }: {
  buildInfo: BuildInfo | null;
  onOpenSkills: () => void;
}) {
  return (
    <>
      <div className="rounded-lg border bg-muted/20 p-3">
        <h3 className="text-sm font-semibold text-foreground">What this plugin gives you</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          This plugin hosts Stelow inside bb: Build, Research, and Explore boards,
          a quiet inbox that only interrupts when the agent needs you, and a worker
          CLI with deterministic artifact checks.
        </p>
        {buildInfo ? (
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <p className="flex items-center gap-1.5">
              <span aria-hidden className="text-emerald-500">●</span>
              <button
                type="button"
                onClick={onOpenSkills}
                className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-foreground"
                title={`Pinned to Stelow ${buildInfo.stelowVersion ?? "at this plugin release"} — click to see which skills shipped`}
              >
                {buildInfo.skills.length} skills · pinned to Stelow {buildInfo.stelowVersion ?? "this release"}
              </button>
            </p>
            <p>Skills refresh with plugin updates — this pin names the methodology this build carries.</p>
          </div>
        ) : null}
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Working as a team? bb is single-user —{" "}
          <UrlLink
            href="https://calionauta.github.io/stelow/#teams"
            className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-foreground"
          >
            see the experimental team playbook
          </UrlLink>
          : one bb per teammate, GitHub as the team room.
        </p>
      </div>
    </>
  );
}

function ResourcesCard() {
  const [confirming, setConfirming] = useState(false);
  function reset() {
    resetOnboarding(window.localStorage);
    setConfirming(false);
    toast.success("Onboarding reset — Build, Research, and Explore open their setup dialogs again on visit.");
  }
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <h3 className="text-sm font-semibold text-foreground">Resources & maintenance</h3>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <RepoLink href="https://github.com/calionauta/bb-plugin-stelow">Plugin repo</RepoLink>
        {confirming ? (
          <>
            <Button
              size="sm"
              variant="destructive"
              onClick={reset}
              title="Clear onboarding state so every track shows its setup dialog again"
            >
              Confirm reset
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirming(true)}
            title="Show the first-visit setup dialogs again"
          >
            Reset onboarding
          </Button>
        )}
      </div>
    </div>
  );
}

function SkillsDialog({ open, onOpenChange, buildInfo }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buildInfo: BuildInfo | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Vendored Stelow skills</DialogTitle>
          <DialogDescription>
            Pinned to Stelow {buildInfo?.stelowVersion ?? "this plugin release"}.
            Workers load these exact files from the plugin — no network or silent
            updates at card time.
          </DialogDescription>
        </DialogHeader>
        {(["stelow-workflow-", "stelow-product-"] as const).map((prefix) => {
          const group = (buildInfo?.skills ?? []).filter((name) => name.startsWith(prefix));
          if (!group.length) return null;
          return (
            <div key={prefix} className="mt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {prefix === "stelow-workflow-" ? "Workflow" : "Product playbooks"} ({group.length})
              </h3>
              <ul className="mt-1 space-y-0.5">
                {group.map((name) => (
                  <li key={name} className="font-mono text-xs text-foreground">
                    {name.replace(prefix, "")}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        <div className="mt-4">
          <RepoLink href="https://github.com/calionauta/stelow/tree/main/skills">Upstream skills</RepoLink>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AboutPanel() {
  const { buildInfo, setBuildInfo, aboutLogo } = useAboutData();
  const hostTools = useHostToolState();
  const update = usePluginUpdateActions(buildInfo, setBuildInfo);
  const [skillsOpen, setSkillsOpen] = useState(false);
  return (
    <>
      <div className="flex h-full overflow-hidden bg-background">
        <div className="flex-1 overflow-auto p-4 md:p-6">
          <div className="mx-auto max-w-[1500px] space-y-4">
            <div className="grid max-w-2xl gap-5">
              <AboutHeading buildInfo={buildInfo} aboutLogo={aboutLogo} />
              <section className="space-y-3">
                <h2 className="text-base font-semibold text-foreground">
                  bb-plugin-stelow {buildInfo ? (
                    <span
                      className="text-[11px] font-normal text-muted-foreground"
                      title={buildInfo.builtAt ? `Built ${new Date(buildInfo.builtAt).toLocaleString()}` : "Running build"}
                    >
                      v{buildInfo.version}
                    </span>
                  ) : null}
                </h2>
                <UpdateCard buildInfo={buildInfo} actions={update} />
                <PluginSummary buildInfo={buildInfo} onOpenSkills={() => setSkillsOpen(true)} />
                <WorkflowDependencyCard />
                <ResourcesCard />
                <HostToolsSection
                  tools={hostTools.tools}
                  onInstall={hostTools.install}
                  installingId={hostTools.installingId}
                  errors={hostTools.errors}
                />
              </section>
            </div>
          </div>
        </div>
      </div>
      <SkillsDialog open={skillsOpen} onOpenChange={setSkillsOpen} buildInfo={buildInfo} />
    </>
  );
}
