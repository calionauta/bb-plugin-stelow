# Runtime dependencies, and how diagrams render

Two absences cost real time on this repo, so they live in one page: what this
plugin actually needs installed, and how a diagram reaches the screen. The
plugin's *behaviour* is elsewhere (`FEATURES.md`, the tests); this page is the
operator's install-and-explain view. The GitHub Pages site carries the condensed
user version and must not be edited from here.

## Mandatory dependencies

Everything below is required. Each row carries the command that verifies it —
run the command, read the answer, do not assume.

| Dependency | Why it is required | Verify |
|---|---|---|
| `node` / `npm` | The plugin is Node 22 (`.node-version`); the server, the build and every test run on it. | `node -v && npm -v` |
| `git` | The card's workspace is a repository: state dirs resolve from `git rev-parse --show-toplevel`, run bundles are exported into the tree, and `export --check` reports whether a bundle is committed. | `git --version` |
| `bash` | The upstream helper (`data/stelow`, a synced copy of `calionauta/stelow`) is a bash script; the workflow cannot advance without it. | `bash --version` |
| `python3` | That same helper parses its state files with Python — `state.md` frontmatter and the workflow's JSON files. No Python package is needed. | `python3 -V` |
| `pele` | The diagram renderer. **Nothing to install:** it is a pinned dependency (`pele@1.8.0` in `package.json`), so `npm ci` puts it in `node_modules` with the plugin. | `node --input-type=module -e "import('pele').then(m => console.log(typeof m.render))"` |

### Two symptoms that look like code and are not

Both mean the install under you is incomplete or was built for a different
machine — not that the change you just made is wrong.

- **`Could not locate the bindings file`** — a native module is missing its
  compiled binary, almost always `better-sqlite3` (tests and the plugin's own
  store use it). The source is fine. Reinstall, or rebuild only that module:

  ```
  npm ci            # from a clean checkout
  npm rebuild better-sqlite3   # to reuse the rest of node_modules
  ```

  Do not go looking for a bug in the store: a missing binding is the install.

- **`Cannot find module 'pele'`** — the install did not finish, or a worktree is
  sharing a `node_modules` that predates the pin. It is a dependency, not an
  optional extra, so a failure to resolve it is an incomplete install:
  `npm ci` (or run `npm install` in the checkout whose `node_modules` you share).

## How diagrams render now

A diagram is **source**, and the picture is derived at read time. There is no SVG
artifact: nothing writes one, nothing versions one, and nothing can drift from
the text it came from.

- **A fenced ` ```mermaid ` block** in a diagrammable Markdown artifact
  (`spec-tech`, `architecture`, `interface`) renders on read — the first fenced
  block only, and only when the renderer accepts it. The prose stays beside it.
- **A `.mmd` artifact** renders on read with the bundled `pele` renderer,
  with pan-and-zoom. `.mmd` is also what the Scope Map derives: the map
  (`scope-map.json`) is the source of truth and the flowchart is computed from
  it, never authored beside it.
- **A render failure falls back to the source.** If `pele` is absent or refuses
  the source, the reader gets the source text plus a pele.run playground link —
  never a blank box presented as a diagram. The diagram is a view; the file is
  the artifact.
- **`breadboard.json` derives nothing** on read: its canonical `.mmd`/`.html`
  views already exist beside it, and a second serializer would eventually
  disagree with the first.

The decision is owned by one function (`derivedDiagram` in
`lib/artifact-diagram.mjs`, over `artifactRenderKind` in
`lib/artifact-render.mjs`), and `diagramRendererStatus` reports bundled-vs-absent
in the About tab's Diagram renderer card.
