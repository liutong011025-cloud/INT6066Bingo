import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const mode = process.argv[2];
const publicDir = "public";
const outDir = "out";
const keep = new Set([".gitkeep"]);

if (mode === "pre") {
  mkdirSync(publicDir, { recursive: true });
  for (const name of readdirSync(publicDir)) {
    if (!keep.has(name)) rmSync(join(publicDir, name), { recursive: true, force: true });
  }
  process.exit(0);
}

if (mode === "post") {
  if (!existsSync(outDir)) {
    console.error('Missing out/ after next build. Static export did not run.');
    process.exit(1);
  }
  mkdirSync(publicDir, { recursive: true });
  cpSync(outDir, publicDir, { recursive: true });
  console.log("Copied out/ -> public/ for Vercel outputDirectory=public");
  process.exit(0);
}

console.error("Usage: node scripts/sync-static-output.mjs pre|post");
process.exit(1);
