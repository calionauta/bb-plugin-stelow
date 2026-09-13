import assert from "node:assert/strict";
import { PREVIEW_PROBE_FILES, detectPreview, parseDeclaredPreview, parsePreviewUrl, pickAppDir, previewAppDirs, previewCommand, previewFailed, previewLabel, previewReady, previewSnapshot } from "../lib/preview-detect.mjs";

const snap = (files) => previewSnapshot(files);

// --- Declared wins over everything: the project's own words. -----------------
const declared = parseDeclaredPreview('{"command": "make serve", "port": 9090}');
assert.deepEqual(declared, { command: "make serve", port: 9090, url: null, framework: "declared" });
assert.equal(parseDeclaredPreview("not json"), null);
assert.equal(parseDeclaredPreview('{"port": 3000}'), null, "a declared preview needs a command");
assert.equal(parseDeclaredPreview('{"command": "  "}'), null, "a blank command is not a command");
assert.equal(parseDeclaredPreview('{"command": "x", "port": 70000}').port, null, "an impossible port is dropped, not obeyed");
const declaredWins = detectPreview(snap({ ".stelow/preview.json": '{"command": "make serve", "port": 9090}', "package.json": '{"scripts":{"dev":"next dev"}}' }));
assert.equal(declaredWins.framework, "declared");
assert.equal(declaredWins.command, "make serve");
assert.equal(declaredWins.tier, "declared");

// --- Node: the framework names the default port, the lockfile names the runner.
for (const [dep, id, port, lock, runner] of [
  ["next", "next", 3000, "pnpm-lock.yaml", "pnpm run dev"],
  ["vite", "vite", 5173, "package-lock.json", "npm run dev"],
  ["astro", "astro", 4321, "bun.lockb", "bun run dev"],
  ["@sveltejs/kit", "svelte-kit", 5173, "yarn.lock", "yarn dev"],
]) {
  const found = detectPreview(snap({ "package.json": JSON.stringify({ dependencies: { [dep]: "^1" }, scripts: { dev: "x" } }), [lock]: "" }));
  assert.equal(found.framework, id, `${dep} detected`);
  assert.equal(found.port, port, `${dep} default port`);
  assert.equal(found.command, runner, `${dep} runs through its lockfile's manager`);
}
// Create React App keeps its own start script.
const cra = detectPreview(snap({ "package.json": JSON.stringify({ dependencies: { "react-scripts": "^5" }, scripts: { start: "x", build: "y", test: "z" } }), "package-lock.json": "" }));
assert.equal(cra.framework, "react-scripts");
assert.equal(cra.command, "npm run start", "a project with no dev script falls through to start");
// A plain Node server is still worth showing: the script is the signal.
const plain = detectPreview(snap({ "package.json": JSON.stringify({ scripts: { start: "node server.js" } }) }));
assert.equal(plain.framework, "node");
assert.equal(plain.command, "npm run start");
assert.equal(plain.port, null, "an unknown stack does not invent a port");
assert.equal(detectPreview(snap({ "package.json": JSON.stringify({ scripts: { build: "webpack" } }) })), null, "a build-only package is not a server");
assert.equal(detectPreview(snap({ "package.json": "not json" })), null);

// --- Go: the Makefile target wins over guessing a main package. --------------
const goMake = detectPreview(snap({ "go.mod": "module x", Makefile: "APP_DIR := cmd/web\nPORT ?= 8080\n\nrun:\n\t@PORT=$(PORT) ./x\n\ndev:\n\t@air\n" }));
assert.equal(goMake.framework, "go-make");
assert.equal(goMake.command, "make dev");
assert.equal(goMake.port, 8080, "PORT ?= in the Makefile is the project's own answer");
assert.equal(detectPreview(snap({ "go.mod": "module x", Makefile: "build:\n\tgo build\n" })), null, "a Makefile without dev/run is not a server");
const goPlain = detectPreview(snap({ "go.mod": "module x", "cmd/web/main.go": "package main" }));
assert.equal(goPlain.command, "go run ./cmd/web");
assert.equal(detectPreview(snap({ "go.mod": "module x", "internal/x/x.go": "package x" })), null, "no entry point, no preview");

// --- Python: entry point first, framework markers second. --------------------
const django = detectPreview(snap({ "manage.py": "#!/usr/bin/env python" }));
assert.equal(django.framework, "django");
assert.equal(django.port, 8000);
assert.equal(django.frames, false, "Django refuses framing by default; the panel must know that");
const fastapi = detectPreview(snap({ "requirements.txt": "fastapi", "main.py": "app = FastAPI()\n" }));
assert.equal(fastapi.command, "python3 -m uvicorn main:app --reload");
assert.equal(detectPreview(snap({ "requirements.txt": "requests" })), null, "a library project is not a server");
assert.equal(detectPreview(snap({ "app.py": "print('hi')" })), null, "a module marker must actually be there");

// --- A self-contained page is a deliverable, served from its own directory. --
const html = snap({ "index.html": "<html></html>" });
assert.equal(detectPreview(html), null, "a static page is not offered without the caller asking");
const page = detectPreview(html, { allowStatic: true });
assert.equal(page.framework, "static");
assert.match(page.command, /--bind 127\.0\.0\.1/, "a served directory must still bind loopback");
assert.equal(previewCommand(page, 8080), "python3 -m http.server --bind 127.0.0.1 8080");
assert.equal(detectPreview(snap({ "index.htm": "<html></html>" }), { allowStatic: true }).framework, "static");
assert.equal(detectPreview(snap({ "public/index.html": "<html></html>" }), { allowStatic: true }), null, "a nested page is found by directory discovery, not guessed from a fixed list");

// --- Finding the app one level down, without guessing. ----------------------
// Agents routinely create the deliverable in a subdirectory named after the
// work; a root-only search would answer "nothing to preview" for a product that
// is finished and sitting right there.
assert.deepEqual(previewAppDirs(["web", "api", ".git", "node_modules", "skills", "dist", "target", ".stelow"]), ["api", "web"]);
assert.deepEqual(previewAppDirs([]), []);
assert.deepEqual(previewAppDirs(null), []);
assert.equal(pickAppDir(["api", "web"], "web"), "web", "the directory named after the card wins");
assert.equal(pickAppDir(["jogo-da-velha"], "Jogo da Velha"), "jogo-da-velha", "a display name normalizes to its slug");
assert.equal(pickAppDir(["only"], null), "only", "a single candidate is unambiguous");
assert.equal(pickAppDir(["api", "web"], "nothing-matches"), null, "two candidates and no name match is not a guess");
assert.equal(pickAppDir(["api", "web"], null), null);
assert.equal(pickAppDir([], "web"), null);
assert.equal(pickAppDir(["api", "web"], "Api"), "api", "a slug match is case-insensitive");

// --- Reading the server's own announcement beats guessing the port. ----------
assert.deepEqual(parsePreviewUrl("  ➜  Local:   http://localhost:5173/"), { url: "http://localhost:5173", port: 5173 });
assert.deepEqual(parsePreviewUrl("listening on port 8080"), { url: "http://localhost:8080", port: 8080 });
assert.deepEqual(parsePreviewUrl("a http://localhost:3000 b http://localhost:5173"), { url: "http://localhost:5173", port: 5173 }, "the last announcement wins");
assert.equal(parsePreviewUrl("no address here"), null);
assert.deepEqual(previewReady("ready in 320 ms", 3000), { url: "http://localhost:3000", port: 3000 }, "a ready line with a known port is enough");
assert.equal(previewReady("ready in 320 ms", null), null, "a ready line with no port is not an address");
assert.match(previewFailed("Error: listen EADDRINUSE: address already in use :::8080"), /EADDRINUSE/);
assert.equal(previewFailed("compiled successfully"), null);

// --- Port injection: each stack gets the spelling it actually understands. ---
assert.equal(previewCommand({ command: "npm run dev", portFlag: "--port" }, 5174), "npm run dev --port 5174");
assert.equal(previewCommand({ command: "make dev", portFlag: "env" }, 8090), "PORT=8090 make dev");
assert.equal(previewCommand({ command: "python3 manage.py runserver", portFlag: "arg" }, 8001), "python3 manage.py runserver 8001");
assert.equal(previewCommand({ command: "python3 -m streamlit run app.py", portFlag: "streamlit" }, 8502), "python3 -m streamlit run app.py --server.port 8502");
assert.equal(previewCommand({ command: "make serve", portFlag: "none" }, 9090), "make serve", "a declared command is obeyed verbatim");
assert.equal(previewCommand({ command: "go run .", portFlag: "env" }, null), "go run .", "no port, no injection");
assert.equal(previewCommand({ command: "vite --port 1234", portFlag: "--port" }, 5174), "vite --port 1234", "a command that already names a port is left alone");

assert.equal(previewLabel({ framework: "go-make" }), "Go (make)");
assert.equal(previewLabel(null), "No web app detected");

// --- Probing exactly PREVIEW_PROBE_FILES must be enough. ---------------------
// The caller reads this list and nothing else, so a stack whose evidence is not
// in it would be undetectable in the panel while looking correct here.
for (const [label, files, framework] of [
  ["next", { "package.json": '{"dependencies":{"next":"^1"},"scripts":{"dev":"x"}}' }, "next"],
  ["go", { "go.mod": "module x", Makefile: "dev:\n\t@air\n" }, "go-make"],
  ["django", { "manage.py": "#!/usr/bin/env python" }, "django"],
  ["streamlit", { "streamlit_app.py": "import streamlit" }, "streamlit"],
  ["declared", { ".stelow/preview.json": '{"command":"make serve"}' }, "declared"],
]) {
  const probeOnly = Object.fromEntries(Object.entries(files).filter(([rel]) => PREVIEW_PROBE_FILES.includes(rel)));
  assert.equal(Object.keys(probeOnly).length, Object.keys(files).length, `${label} evidence is all in the probe list`);
  assert.equal(detectPreview(snap(probeOnly)).framework, framework, `${label} is detectable from the probe list alone`);
}
assert.equal(PREVIEW_PROBE_FILES.includes("package-lock.json"), true, "a lockfile is what names the runner");

console.log("preview detect test ok: declared/framework/static tiers, output parsing, port injection, probe sufficiency, app-dir discovery");
