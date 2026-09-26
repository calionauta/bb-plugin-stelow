import { DecisionApiSection, DecisionRoutersSection } from "./decision-api";
import { DisclosureSection } from "../disclosure";
import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";

type ManagerRpc = ReturnType<typeof useRpc<typeof rpcContract>>;

/**
 * The two RPC-backed API sections. They are the same disclosure with a different
 * body and no state of their own, so they are one component here rather than two
 * blocks of chrome in the shell — and adding a third such section is now one line
 * at the call site rather than another copy of the wrapper.
 */
export function PresetManagerApiSections({ rpc }: { rpc: ManagerRpc }) {
  return (
    <>
      <DisclosureSection title="Decision API" hint="Jev-compatible" defaultOpen={false}>
        <DecisionApiSection rpc={rpc} />
      </DisclosureSection>
      <DisclosureSection title="Decision routers" hint="per-judgment modes" defaultOpen={false}>
        <DecisionRoutersSection rpc={rpc} />
      </DisclosureSection>
    </>
  );
}
