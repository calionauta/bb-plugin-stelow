import { DisclosureSection } from "../disclosure";
import type { ReactNode } from "react";
import type { PresetManagerRoutingProps } from "./preset-manager-routing-props";

export type { PresetManagerRoutingProps } from "./preset-manager-routing-props";

/**
 * The disclosure wrapper both routing sections share. Band routing and delegated
 * work are one feature — "which preset runs this work" — told twice, and the
 * second telling existed only because the first could not be wrapped. The hint
 * and the explanation are therefore the section's own words, not the caller's,
 * so the two cannot drift into saying different things about the same state.
 */
export function PresetManagerRoutingSection({
  title,
  hint,
  explanation,
  children,
}: PresetManagerRoutingProps & {
  title: string;
  hint: string;
  explanation: string;
  children: ReactNode;
}) {
  return (
    <DisclosureSection title={title} hint={hint} defaultOpen={false}>
      <p className="mb-2 text-xs text-muted-foreground">{explanation}</p>
      {children}
    </DisclosureSection>
  );
}
