import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const pluginRoot = process.cwd();
const dist = join(pluginRoot, "dist");
if (!existsSync(dist)) {
  console.error("postbuild: dist/ not found; run `bb plugin build` first");
  process.exit(1);
}

function copyTree(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) copyTree(srcPath, destPath);
    else copyFileSync(srcPath, destPath);
  }
}

copyTree(join(pluginRoot, "data"), join(dist, "data"));
copyTree(join(pluginRoot, "references"), join(dist, "references"));
copyTree(join(pluginRoot, "skills"), join(dist, "skills"));
console.log("postbuild: data/, references/ and skills/ copied to dist/");

// Mirror proof: the shipped dist/skills tree must carry the freeze marker the
// red-first pipeline froze. A skills/ diff in git proves only that someone
// committed it; grepping the shipped dist/skills/<file> is the only proof the
// upstream change reached users (see AGENTS.md "Skills sync"). Warn-only
// until the upstream contract (Fase 0-2) ships freeze markers — a missing
// marker means "not yet frozen upstream", never a broken build.
try {
  const out = execFileSync("grep", ["-rli", "freeze", join(dist, "skills")], { encoding: "utf8" }).trim();
  const hits = out ? out.split("\n").filter(Boolean) : [];
  if (hits.length === 0) {
    console.warn("postbuild: dist/skills carries no freeze marker yet — upstream freeze not synced (warn-only until Fase 0-2 lands)");
  } else {
    console.log(`postbuild: dist/skills freeze mirror ok (${hits.length} files)`);
  }
} catch (error) {
  if (error?.status === 1) {
    console.warn("postbuild: dist/skills carries no freeze marker yet — upstream freeze not synced (warn-only until Fase 0-2 lands)");
  } else {
    console.error(`postbuild: freeze mirror grep failed: ${error?.message ?? String(error)}`);
    process.exit(1);
  }
}

// Freshness signal: the panel and bb caches are sticky, so the UI shows the
// exact running build (version + build time) instead of leaving users
// guessing whether a reload took effect.
try {
  const pkg = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8"));
  writeFileSync(
    join(dist, "version.json"),
    JSON.stringify({ version: pkg.version ?? "dev", builtAt: new Date().toISOString() }) + "\n",
  );
  console.log("postbuild: version.json written to dist/");
} catch (error) {
  console.error("postbuild: could not write version.json:", error.message);
  process.exit(1);
}
