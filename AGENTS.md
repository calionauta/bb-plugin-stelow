# Plugin development

After every change to this BB plugin, run `npm run build` before handing off or committing. The build regenerates the plugin bundle and triggers BB's automatic hot-reload.

Do not restart `bb-daemon.service` to reload this plugin; it terminates active BB threads.
