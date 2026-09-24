import { defineRpcContract } from "@get-bb/plugin-sdk";
import { decisionApiRpcContract } from "./decision-api.js";
import { githubRpcContract } from "./github-issues.js";
import { inboxRpcContract } from "./inbox.js";
import { publicationRpcContract } from "./artifacts-publication.js";
import { workspaceRecoveryRpcContract } from "./workspaces-recovery.js";
import { cardRpcContract } from "./card-rpc-contract.js";
import { lifecycleRpcContract } from "./lifecycle-rpc-contract.js";
import { platformRpcContract } from "./platform-rpc-contract.js";

export const RPC_FRAGMENTS = [
  cardRpcContract,
  githubRpcContract,
  decisionApiRpcContract,
  inboxRpcContract,
  lifecycleRpcContract,
  publicationRpcContract,
  workspaceRecoveryRpcContract,
  platformRpcContract,
];

export function composeRpcFragments(fragments: ReadonlyArray<Record<string, unknown>>): Record<string, unknown> {
  const composed: Record<string, unknown> = {};
  for (const fragment of fragments) {
    for (const name of Object.keys(fragment)) {
      if (name in composed) throw new Error(`Duplicate RPC contract fragment key: ${name}`);
      composed[name] = fragment[name];
    }
  }
  return composed;
}

export const rpcContract = defineRpcContract({
  ...cardRpcContract,
  ...githubRpcContract,
  ...decisionApiRpcContract,
  ...inboxRpcContract,
  ...lifecycleRpcContract,
  ...publicationRpcContract,
  ...workspaceRecoveryRpcContract,
  ...platformRpcContract,
});
