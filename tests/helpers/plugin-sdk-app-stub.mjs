/**
 * The host surface, stubbed, for tests that RENDER plugin components.
 *
 * `@get-bb/plugin-sdk/app` outside the host bundle exports no live hooks
 * (`useRpc is not a function`), so a component that reads them cannot be
 * rendered at all. This module stands in for the boundary the host owns —
 * hooks, navigation, the thread composer — and nothing else: the components
 * under test are the real ones.
 *
 * Only the names the rendered import graph asks for are exported. An
 * unstubbed name would fail loudly (`does not provide an export named …`),
 * which is the point: a silent `undefined` hook is how a test lies.
 */
import { createElement } from "react";

export function useRpc() {
  return { call: async () => ({}) };
}

export function useBbNavigate() {
  const noop = () => {};
  return { toThread: noop, toPluginPanel: noop, toProject: noop };
}

export function useBbContext() {
  return { projectId: "project_1", hostId: "host_1" };
}

export function experimental_NewThreadComposer() {
  return createElement("div", { "data-testid": "host-composer" });
}

/** Realtime channels: the host subscribes; a render test has nothing to push. */
export function useRealtime() {}
