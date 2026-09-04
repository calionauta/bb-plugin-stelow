import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
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
console.log("postbuild: data/, reference/ and skills/ copied to dist/");

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
