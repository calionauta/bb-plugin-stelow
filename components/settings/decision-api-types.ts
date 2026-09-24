import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../server";

export type DecisionApiConfig = {
  endpoint: string;
  model: string;
  hasKey: boolean;
  keySource: string | null;
  keyRequired: boolean;
  disabled: boolean;
  provider: string;
  configured: boolean;
};

export type DecisionPointRoute = {
  provider: string | null;
  endpoint: string | null;
  apiKey: string | null;
  model: string | null;
};

export type DecisionRouterPoint = {
  id: string;
  label: string;
  description: string;
  rules: string;
  requires: string | null;
  modes: string[];
  mode: string;
  thresholds: Record<string, number>;
  route: DecisionPointRoute | null;
  presetId: string | null;
};

export type RouterPresetOption = { id: string; name: string };
export type ManagerRpc = ReturnType<typeof useRpc<typeof rpcContract>>;
