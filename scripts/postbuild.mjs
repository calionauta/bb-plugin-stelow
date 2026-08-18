import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
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
console.log("postbuild: data/ and references/ copied to dist/");
