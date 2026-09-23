import { useEffect, useState } from "react";
import { useRpc, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { qualitySealPresentation } from "../../lib/build-progress-presentation.mjs";
import type { rpcContract } from "../../server";

type QualitySeal = {
  status: string;
  failures?: string[];
  label?: string | null;
};

export function StelowQualityDirective({ attributes, message, openWorkspaceFile }: PluginMessageDirectiveProps) {
  const rpc = useRpc<typeof rpcContract>();
  const path = (attributes.path ?? "").replace(/^\.\//, "");
  const [seal, setSeal] = useState<QualitySeal | null>(null);
  useEffect(() => {
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
  if (!path) return null;
  const view = qualitySealPresentation(seal, path);
  return (
    <button
      onClick={() => openWorkspaceFile?.(path)}
      disabled={!openWorkspaceFile}
      className={[
        "cursor-pointer inline-flex min-h-11 items-center gap-1 rounded-md border px-2",
        "py-0.5 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-60",
        view.tone,
      ].join(" ")}
      title={view.title ?? path}
    >
      <span>{view.icon}</span>
      <span className="text-muted-foreground">quality</span>
      <span className="font-medium">{view.text}</span>
    </button>
  );
}
