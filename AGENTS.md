# Plugin development

After every change to this BB plugin, run `npm run build:reload` before handing off or committing. It regenerates the bundle and explicitly reloads this plugin in the running BB process without interrupting threads.

`npm run build` may hot-reload when `dist/` becomes newer, but do not rely on that signal alone during development. Use `npm run reload` after a successful build whenever the UI still appears stale. Reopen the plugin panel afterwards; use a browser refresh only if the panel remains stale.

When changing `package.json#version`, run `npm run build:reload` after the version bump so the Plugins screen reports the new version.

Do not restart `bb-daemon.service` to reload this plugin; it terminates active BB threads.
