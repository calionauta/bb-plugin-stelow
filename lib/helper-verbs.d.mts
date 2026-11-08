export declare const HELPER: Readonly<{
  advance: "advance";
  auditTrail: "audit-trail";
  config: "config";
  doctor: "doctor";
  lock: "lock";
  schema: "schema";
  scope: "scope";
  syncScopes: "sync-scopes";
}>;
export declare const HOST_HELPER_VERBS: readonly string[];
export declare function isDeclaredVerb(verb: unknown): boolean;
export declare function undeclaredVerbRefusal(verb: unknown): string;
