import { mkdir, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const distDirectory = path.join(root, "dist");
const output = path.join(distDirectory, `tablist-${manifest.version}.zip`);

await mkdir(distDirectory, { recursive: true });
await rm(output, { force: true });

const result = spawnSync("zip", [
  "-qr",
  output,
  "manifest.json",
  "src",
  "README.md",
  "LICENSE"
], {
  cwd: root,
  encoding: "utf8"
});

if (result.status !== 0) {
  console.error(result.stderr || result.stdout || "zip failed");
  process.exit(result.status || 1);
}

console.log(`Wrote ${path.relative(root, output)}`);
