/**
 * Preview detection: decide whether a card's workspace is a web app the user
 * can look at, and with what command and port.
 *
 * Pure by design — the caller supplies a file snapshot (see `previewSnapshot`),
 * so every rule here is testable without a workspace, a host, or a network.
 * The effects (terminal, readiness, opening) live in server.ts.
 *
 * Convention over configuration: a known stack needs nothing. A project that
 * wants to say it explicitly writes `.stelow/preview.json` next to its code —
 * that answer always wins, and it is the escape hatch for anything this module
 * cannot infer.
 */

/** Project-declared answer: `{ "command": "make dev", "port": 8080, "url": "https://…" }`. */
export const PREVIEW_CONFIG_REL = ".stelow/preview.json";

/**
 * Every file detection may look at, and nothing else. The caller reads exactly
 * this list, so probing a workspace is a bounded number of reads and the
 * question "what does detection need?" has one answer — this constant.
 */
export const PREVIEW_PROBE_FILES = [
  PREVIEW_CONFIG_REL,
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "go.mod",
  "Makefile",
  "makefile",
  "pyproject.toml",
  "requirements.txt",
  "Pipfile",
  "manage.py",
  "main.py",
  "app/main.py",
  "app.py",
  "streamlit_app.py",
  "index.html",
  "public/index.html",
  "static/index.html",
  "web/index.html",
];

/**
 * A preview is only offered when detection is confident. `declared` is the
 * user's own words, `framework` is a stack this module knows, `static` is a
 * page with no server of its own (offered only when asked for explicitly).
 */
export const PREVIEW_TIERS = ["declared", "framework", "static"];

const NODE_PACKAGE_MANAGER = [
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

/**
 * Node stacks by dependency. `port` is the framework's default, `flag` is how
 * that framework accepts a different one, `script` is the script to run when
 * the project does not have the usual `dev`.
 */
const NODE_FRAMEWORKS = [
  { id: "next", dep: "next", port: 3000, flag: "--port" },
  { id: "vite", dep: "vite", port: 5173, flag: "--port" },
  { id: "astro", dep: "astro", port: 4321, flag: "--port" },
  { id: "nuxt", dep: "nuxt", port: 3000, flag: "--port" },
  { id: "svelte-kit", dep: "@sveltejs/kit", port: 5173, flag: "--port" },
  { id: "remix", dep: "@remix-run/dev", port: 3000, flag: "--port" },
  { id: "react-scripts", dep: "react-scripts", port: 3000, flag: null, script: "start" },
];

/** Python entry points, in the order a project is most likely to mean one. */
const PYTHON_FRAMEWORKS = [
  { id: "django", file: "manage.py", port: 8000, frames: false },
  { id: "fastapi", file: "main.py", marker: "FastAPI(", port: 8000, module: "main:app" },
  { id: "fastapi", file: "app/main.py", marker: "FastAPI(", port: 8000, module: "app.main:app" },
  { id: "flask", file: "app.py", marker: "Flask(", port: 5000, module: "app" },
  { id: "streamlit", file: "streamlit_app.py", port: 8501 },
  { id: "streamlit", file: "app.py", marker: "st.", port: 8501 },
];

/** Fetched lazily by the caller; a snapshot is `{ exists, read }` over one workspace. */
export function previewSnapshot(files) {
  const map = files instanceof Map ? files : new Map(Object.entries(files));
  return {
    exists: (rel) => map.has(rel),
    read: (rel) => (map.has(rel) ? map.get(rel) : null),
  };
}

/** Parse a declared `.stelow/preview.json`; anything unusable is ignored. */
export function parseDeclaredPreview(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const command = typeof value.command === "string" ? value.command.trim() : "";
  if (!command) return null;
  const port = Number.isInteger(value.port) && value.port > 0 && value.port < 65536 ? value.port : null;
  return { command, port, url: typeof value.url === "string" && value.url.trim() ? value.url.trim() : null, framework: "declared" };
}

/**
 * The URL a dev server announces in its own output. Dev servers print it
 * (`Local: http://localhost:5173/`, `listening on port 8080`), so this is the
 * one fact we never have to guess — read it back instead.
 */
export function parsePreviewUrl(text) {
  if (typeof text !== "string" || !text) return null;
  const urls = [...text.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[\w.-]+):(\d{2,5})\b/g)];
  if (urls.length) {
    const match = urls[urls.length - 1];
    const port = Number(match[1]);
    // Bind addresses are not browse addresses: a server that announces
    // `0.0.0.0:8080` (what a container or a `--host` run prints) must still
    // open at localhost, or the link is dead on arrival.
    const host = /(?:0\.0\.0\.0|\[::1\]|127\.0\.0\.1|localhost)/.test(match[0].split("//")[1]) ? "localhost" : match[0].split("//")[1].split(":")[0];
    if (port > 0 && port < 65536) return { url: `http://${host}:${port}`, port };
  }
  const port = [...text.matchAll(/(?:listening|running|serving) (?:on|at) (?:port |:)?(\d{2,5})\b/gi)].pop();
  if (port) {
    const value = Number(port[1]);
    if (value > 0 && value < 65536) return { url: `http://localhost:${value}`, port: value };
  }
  return null;
}

/**
 * The dev server is ready when it has announced an address, or when it says so
 * without one and a port is already known.
 */
export function previewReady(output, port) {
  const announced = parsePreviewUrl(output);
  if (announced) return announced;
  if (port && /(ready in|compiled successfully|listening|started server|running on)/i.test(output)) {
    return { url: `http://localhost:${port}`, port };
  }
  return null;
}

/** Output that means the process is not going to come up. */
export function previewFailed(output) {
  if (typeof output !== "string" || !output) return null;
  const line = output
    .split("\n")
    .reverse()
    .find((entry) => /(EADDRINUSE|EACCES|command not found|not found:|Traceback \(most recent call last\)|cannot find|No such file or directory|error when starting dev server|failed to compile)/i.test(entry));
  return line ? line.trim().slice(0, 300) : null;
}

function nodeManager(snapshot) {
  for (const [lock, manager] of NODE_PACKAGE_MANAGER) if (snapshot.exists(lock)) return manager;
  return "npm";
}

function detectNode(snapshot) {
  const raw = snapshot.read("package.json");
  if (!raw) return null;
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return null;
  }
  const scripts = pkg && typeof pkg.scripts === "object" && pkg.scripts ? pkg.scripts : {};
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const known = NODE_FRAMEWORKS.find((entry) => entry.dep in deps) ?? null;
  const script = ["dev", "start", "serve"].find((name) => typeof scripts[name] === "string");
  if (!script) return null;
  const manager = nodeManager(snapshot);
  const run = manager === "yarn" ? `yarn ${script}` : manager === "bun" ? `bun run ${script}` : `${manager} run ${script}`;
  return {
    framework: known?.id ?? "node",
    command: run,
    port: known?.port ?? null,
    portFlag: known?.flag ?? null,
    // Nothing to run is a stronger signal than a framework: a plain Node
    // service with a `start` script is still a server worth showing.
    tier: "framework",
    evidence: known ? `${known.dep} in dependencies, ${manager} run ${script}` : `package.json script "${script}"`,
    frames: true,
  };
}

function detectGo(snapshot) {
  if (!snapshot.exists("go.mod")) return null;
  const makefile = snapshot.read("Makefile") ?? snapshot.read("makefile") ?? "";
  const target = /^dev\s*:/m.test(makefile) ? "dev" : /^run\s*:/m.test(makefile) ? "run" : null;
  const declaredPort = /^PORT\s*[?:]?=\s*(\d{2,5})\s*$/m.exec(makefile);
  if (target) {
    return {
      framework: "go-make",
      command: `make ${target}`,
      port: declaredPort ? Number(declaredPort[1]) : null,
      portFlag: declaredPort ? "env" : null,
      tier: "framework",
      evidence: `Makefile target "${target}"${declaredPort ? ` with PORT ?= ${declaredPort[1]}` : ""}`,
      frames: true,
    };
  }
  const main = snapshot.exists("cmd/web/main.go") ? "./cmd/web" : snapshot.exists("cmd/server/main.go") ? "./cmd/server" : snapshot.exists("main.go") ? "." : null;
  if (!main) return null;
  return {
    framework: "go",
    command: `go run ${main}`,
    port: null,
    portFlag: "env",
    tier: "framework",
    evidence: `go.mod with ${main === "." ? "main.go" : `${main}/main.go`}`,
    frames: true,
  };
}

function detectPython(snapshot) {
  const hasPython = snapshot.exists("pyproject.toml") || snapshot.exists("requirements.txt") || snapshot.exists("Pipfile") || PYTHON_FRAMEWORKS.some((entry) => snapshot.exists(entry.file));
  if (!hasPython) return null;
  for (const entry of PYTHON_FRAMEWORKS) {
    const content = snapshot.read(entry.file);
    if (content === null) continue;
    if (entry.marker && !content.includes(entry.marker)) continue;
    if (entry.id === "django") {
      return { framework: "django", command: "python3 manage.py runserver", port: entry.port, portFlag: "arg", tier: "framework", evidence: "manage.py", frames: entry.frames };
    }
    if (entry.id === "fastapi") {
      return { framework: "fastapi", command: `python3 -m uvicorn ${entry.module} --reload`, port: entry.port, portFlag: "flag", tier: "framework", evidence: `${entry.file} defines a FastAPI app`, frames: true };
    }
    if (entry.id === "flask") {
      return { framework: "flask", command: "python3 -m flask run", port: entry.port, portFlag: "flag", tier: "framework", evidence: `${entry.file} defines a Flask app`, frames: true };
    }
    return { framework: "streamlit", command: `python3 -m streamlit run ${entry.file}`, port: entry.port, portFlag: "streamlit", tier: "framework", evidence: `${entry.file} uses streamlit`, frames: true };
  }
  return null;
}

function detectStatic(snapshot) {
  const page = ["index.html", "public/index.html", "static/index.html", "web/index.html"].find((rel) => snapshot.exists(rel));
  if (!page) return null;
  return {
    framework: "static",
    command: `python3 -m http.server`,
    port: 8000,
    portFlag: "arg",
    tier: "static",
    evidence: page,
    frames: true,
  };
}

/**
 * Detect a preview for one workspace snapshot. Returns null when nothing here
 * is a web app the user could look at — the honest answer, and the one that
 * keeps the affordance off a library or a CLI.
 */
export function detectPreview(snapshot, options = {}) {
  const declared = options.declared !== undefined ? options.declared : snapshot.read(PREVIEW_CONFIG_REL);
  const parsed = parseDeclaredPreview(declared);
  if (parsed) return { ...parsed, tier: "declared", evidence: PREVIEW_CONFIG_REL, portFlag: parsed.port ? "none" : null };
  const detected = detectNode(snapshot) ?? detectGo(snapshot) ?? detectPython(snapshot);
  if (detected) return detected;
  if (options.allowStatic) return detectStatic(snapshot);
  return null;
}

/**
 * The command to run, with a port the caller chose. A framework that takes a
 * flag gets one; a framework that reads an environment variable gets that
 * (which is also the only way to move a `make` target off its default);
 * a command that already names its port is left alone.
 */
export function previewCommand(detection, port) {
  if (!detection || !port) return detection?.command ?? "";
  const { command, portFlag } = detection;
  // The declared return type is a string, so a detection without a command
  // yields an empty one rather than `undefined` leaking into the panel.
  if (!portFlag || portFlag === "none") return command ?? "";
  if (/\s--port\s|\s-p\s|\s\d{2,5}\s*$/.test(command)) return command;
  if (portFlag === "--port") return `${command} --port ${port}`;
  if (portFlag === "flag") return `${command} --port ${port}`;
  if (portFlag === "arg") return `${command} ${port}`;
  if (portFlag === "streamlit") return `${command} --server.port ${port}`;
  return `PORT=${port} ${command}`;
}

/** Human-sized label for a detected framework, used by the panel and the CLI. */
export function previewLabel(detection) {
  if (!detection) return "No web app detected";
  const names = {
    next: "Next.js",
    vite: "Vite",
    astro: "Astro",
    nuxt: "Nuxt",
    "svelte-kit": "SvelteKit",
    remix: "Remix",
    "react-scripts": "Create React App",
    node: "Node",
    "go-make": "Go (make)",
    go: "Go",
    django: "Django",
    fastapi: "FastAPI",
    flask: "Flask",
    streamlit: "Streamlit",
    static: "Static page",
    declared: "Declared",
  };
  return names[detection.framework] ?? detection.framework;
}
