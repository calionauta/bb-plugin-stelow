import { useEffect, useState } from "react";
import { useRpc, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { qualitySealPresentation } from "../../lib/build-progress-presentation.mjs";
import { workspaceDirectivePath } from "../../lib/message-directives.mjs";
import type { rpcContract } from "../../server";
import { DirectiveLinkButton, InvalidDirective } from "./directive-link-button";

type QualitySeal = {
  status: string;
  failures?: string[];
  label?: string | null;
};

export function StelowQualityDirective({
  attributes,
  source,
  message,
  openWorkspaceFile,
}: PluginMessageDirectiveProps) {
  const rpc = useRpc<typeof rpcContract>();
  const path = workspaceDirectivePath(attributes.path);
  const [seal, setSeal] = useState<QualitySeal | null>(null);
  useEffect(() => {
    setSeal(null);
    if (!path) return;
    let cancelled = false;
    void rpc.call("qualitySeal", { threadId: message.threadId, path })
      .then((result) => {
        if (!cancelled) setSeal(result);
      })
      .catch(() => {
        if (!cancelled) setSeal({ status: "load-failed" });
      });
    return () => { cancelled = true; };
  }, [rpc, message.threadId, path]);
  if (!path) return <InvalidDirective source={source} />;
  const view = qualitySealPresentation(seal, path);
  return (
    <DirectiveLinkButton
      className={[
        "inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md border",
        "px-2 py-0.5 text-xs text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-60",
      ].join(" ")}
      label="quality"
      openWorkspaceFile={openWorkspaceFile}
      path={path}
      title={view.title ?? path}
      tone={view.tone}
    >
      <span>{view.icon}</span>
      <span className="text-muted-foreground">quality</span>
      <span className="font-medium">{view.text}</span>
    </DirectiveLinkButton>
  );
}
