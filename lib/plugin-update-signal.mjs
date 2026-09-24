let available = false;
let loaded = false;
const listeners = new Set();

export function setPluginUpdateAvailable(next) {
  const normalized = Boolean(next);
  if (available === normalized) return;
  available = normalized;
  for (const listener of listeners) listener();
}

export function subscribePluginUpdate(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function pluginUpdateSnapshot() {
  return available;
}

export function markPluginUpdateLoaded() {
  if (loaded) return false;
  loaded = true;
  return true;
}

export function markPluginUpdateUnloaded() {
  loaded = false;
}
