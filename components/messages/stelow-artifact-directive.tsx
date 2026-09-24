import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { artifactDirectiveView } from "../../lib/message-directives.mjs";
import { DirectiveLinkButton, InvalidDirective } from "./directive-link-button";

export function StelowArtifactDirective({
  attributes,
  source,
  openWorkspaceFile,
}: PluginMessageDirectiveProps) {
  const view = artifactDirectiveView(attributes);
  if (view.kind === "invalid") return <InvalidDirective source={source} />;
  return (
    <DirectiveLinkButton
      className={[
        "inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-md border",
        "border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs text-foreground",
        "hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60",
      ].join(" ")}
      label="artifact"
      openWorkspaceFile={openWorkspaceFile}
      path={view.path}
      title={view.path}
      tone=""
    >
      <span>📎</span>
      <span className="text-muted-foreground">artifact</span>
      <span className="font-medium">{view.display}</span>
    </DirectiveLinkButton>
  );
}
