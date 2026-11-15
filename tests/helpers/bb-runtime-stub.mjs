/**
 * The bb host runtime, as the plugin SDK reads it, for tests that render a
 * component subscribing to realtime.
 *
 * `@get-bb/plugin-sdk/app` reads its hooks off
 * `globalThis.__bbPluginRuntime.pluginSdkApp` exactly once, when the module is
 * first evaluated, so this file has to be imported BEFORE any component that
 * reaches `usePanelData` — a test that imports it second gets the same
 * undefined-hook crash the browser would have got without a host.
 *
 * Everything here is inert on purpose: no channel fires, because a test has no
 * host to fire them. What a test asserts is the state a component renders
 * between events, not the transport that delivers them.
 */
const pluginSdkApp = {
  useRealtime: () => undefined,
  useRealtimeConnectionState: () => "connected",
};

// Spreading `undefined` is legal and yields nothing, so no fallback is needed:
// this file may be imported into a process that already has a partial runtime.
globalThis.__bbPluginRuntime = {
  ...globalThis.__bbPluginRuntime,
  pluginSdkApp,
};
