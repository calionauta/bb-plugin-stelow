import { defineRpcContract } from "@get-bb/plugin-sdk";
import { decisionApiRpcContract } from "./decision-api.js";
import { githubRpcContract } from "./github-issues.js";
import { inboxRpcContract } from "./inbox.js";
import { publicationRpcContract } from "./artifacts-publication.js";
import { workspaceRecoveryRpcContract } from "./workspaces-recovery.js";
import { cardRpcContract } from "./card-rpc-contract.js";
import { cardDetailRpcContract } from "./card-detail-rpc-contract.js";
import { lifecycleRpcContract } from "./lifecycle-rpc-contract.js";
import { platformRpcContract } from "./platform-rpc-contract.js";
import { executionRpcContract } from "./execution-contract.js";

export const RPC_FRAGMENTS = [
  cardRpcContract,
  cardDetailRpcContract,
  githubRpcContract,
  decisionApiRpcContract,
  inboxRpcContract,
  lifecycleRpcContract,
  publicationRpcContract,
  workspaceRecoveryRpcContract,
  platformRpcContract,
  executionRpcContract,
];

type FragmentUnionToIntersection<Fragment> = (Fragment extends unknown ? (value: Fragment) => void : never) extends
  (value: infer Intersection) => void ? Intersection : never;

export function composeRpcFragments<const Fragments extends ReadonlyArray<Record<string, unknown>>>(
  fragments: Fragments,
): FragmentUnionToIntersection<Fragments[number]> {
  const composed: Record<string, unknown> = {};
  for (const fragment of fragments) {
    for (const name of Object.keys(fragment)) {
      if (name in composed) throw new Error(`Duplicate RPC contract fragment key: ${name}`);
      composed[name] = fragment[name];
    }
  }
  return composed as FragmentUnionToIntersection<Fragments[number]>;
}

export const rpcContract = defineRpcContract(composeRpcFragments(RPC_FRAGMENTS));
