export type UiDesignMcpState =
  | "registered"
  | "unregistered"
  | "not-installed"
  | "not-allowed"
  | "unsupported";

export type UiDesignMcpServerId = "inspo";

export interface UiDesignMcpServerMeta {
  id: UiDesignMcpServerId;
  name: string;
  repo: string;
  /** npm package `npx` resolves, so a version can be compared later. */
  package: string;
  /** Config-name spellings that count as this server being registered. */
  aliases: string[];
  /** A vendor command that registers every agent CLI it finds. */
  register: string;
  plain: string;
  /** The workflow step this reference feeds. */
  feeds: string;
  note?: string;
}

export interface UiDesignMcpClientMeta {
  id: string;
  name: string;
  bin: string;
  format: "json" | "toml" | "none";
  /** Home-relative config paths, read in order. */
  configs: string[];
  /** bb provider ids this client answers to. */
  providerIds: string[];
  note?: string;
}

export declare const UI_DESIGN_MCP_SERVERS: UiDesignMcpServerMeta[];
export declare const AGENT_CLIENTS: UiDesignMcpClientMeta[];

export declare function isUiDesignMcpId(value: unknown): boolean;

export declare function clientById(id: string): UiDesignMcpClientMeta | null;

export declare function stripJsonComments(text: string): string;

export declare function jsonMcpNames(text: string): string[];

export declare function tomlMcpNames(text: string): string[];

export declare function declaredMcpNames(
  format: string,
  text: string,
): string[];

export interface UiDesignMcpClientReads {
  installed: boolean;
  names: string[];
  source: string | null;
  pinned?: string | null;
}

export declare function allowedProviderIds(
  providers: Array<{ id: string }> | null | undefined,
): Set<string>;

export declare function clientAllowedByBb(
  client: UiDesignMcpClientMeta,
  allowed: Set<string>,
): boolean;

export declare function registrationStatus(
  server: UiDesignMcpServerMeta,
  client: UiDesignMcpClientMeta,
  reads?: UiDesignMcpClientReads | null,
  allowed?: Set<string> | null,
): { state: UiDesignMcpState; detail: string };

export declare function missingForBb(
  server: UiDesignMcpServerMeta,
  clients: Array<{ state: UiDesignMcpState; name: string }>,
): string[];

export interface UiDesignMcpClientStatus {
  client: string;
  name: string;
  state: UiDesignMcpState;
  detail: string;
}

export interface UiDesignMcpServerStatus {
  id: UiDesignMcpServerId;
  name: string;
  repo: string;
  package: string;
  register: string;
  plain: string;
  feeds: string;
  /** Required on the server view (empty string when the registry omits it). */
  note: string;
  clients: UiDesignMcpClientStatus[];
  /** Installed CLIs that can actually reach it. */
  usable: number;
  /** Installed CLIs bb can run that have not been registered. */
  pending: number;
  /** Names of those CLIs — the actionable fix list. */
  missing: string[];
  state: "ready" | "available" | "absent";
}

export declare function summarizeServers(
  reads?: Record<string, UiDesignMcpClientReads> | null,
  allowed?: Set<string> | null,
): UiDesignMcpServerStatus[];
