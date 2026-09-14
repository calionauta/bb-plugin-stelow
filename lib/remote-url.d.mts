export declare type PushRemote = {
  owner: string;
  repo: string;
  webUrl: string;
} | null;

export declare function parsePushRemoteUrl(outputTail: string | null | undefined): PushRemote;

export declare function branchWebLinks(
  remote: PushRemote,
  branch: string | null | undefined,
  base: string | null | undefined,
): { treeUrl: string; compareUrl: string | null } | null;
