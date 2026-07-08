import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const textExtensions = new Set([".css", ".html", ".js", ".json", ".md", ".txt"]);
const ignoredDirectories = new Set([".git", "dist", "node_modules"]);

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

async function validateJson(relativePath) {
  const fullPath = path.join(root, relativePath);
  try {
    JSON.parse(await readFile(fullPath, "utf8"));
  } catch (error) {
    fail(`${relativePath} is not valid JSON: ${error.message}`);
  }
}

function checkJavaScriptSyntax(file) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: root,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    fail(`${path.relative(root, file)} failed syntax check:\n${result.stderr || result.stdout}`);
  }
}

function checkTextFile(file, content) {
  const relativePath = path.relative(root, file);

  if (content.includes(String.fromCharCode(8212))) {
    fail(`${relativePath} contains an em dash.`);
  }
}

async function validateManifest() {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));

  if (manifest.manifest_version !== 2) {
    fail("manifest.json must use manifest_version 2 for this Firefox-first build.");
  }

  if (!manifest.permissions.includes("tabs") || !manifest.permissions.includes("storage")) {
    fail("manifest.json must request tabs and storage permissions.");
  }

  if (!manifest.background || !Array.isArray(manifest.background.scripts)) {
    fail("manifest.json must declare background scripts.");
  }

  if (!manifest.content_scripts || manifest.content_scripts.length === 0) {
    fail("manifest.json must declare a YouTube content script.");
  }

  const geckoSettings = manifest.browser_specific_settings && manifest.browser_specific_settings.gecko;
  if (!geckoSettings || !geckoSettings.data_collection_permissions) {
    fail("manifest.json must declare Firefox data_collection_permissions.");
    return;
  }

  const dataCollectionPermissions = geckoSettings.data_collection_permissions;
  if (!Array.isArray(dataCollectionPermissions.required)) {
    fail("manifest.json data_collection_permissions.required must be an array.");
  } else if (dataCollectionPermissions.required.length !== 1 || dataCollectionPermissions.required[0] !== "none") {
    fail("manifest.json must declare no external data collection with required data_collection_permissions set to none.");
  }

  if (
    Object.hasOwn(dataCollectionPermissions, "optional") &&
    (!Array.isArray(dataCollectionPermissions.optional) || dataCollectionPermissions.optional.length !== 0)
  ) {
    fail("manifest.json data_collection_permissions.optional must be omitted or empty.");
  }
}

await validateJson("manifest.json");
await validateJson("package.json");
await validateManifest();

const files = await listFiles(root);
for (const file of files) {
  const extension = path.extname(file);

  if (extension === ".js" || extension === ".mjs") {
    checkJavaScriptSyntax(file);
  }

  if (textExtensions.has(extension) || extension === ".mjs" || path.basename(file) === "justfile") {
    checkTextFile(file, await readFile(file, "utf8"));
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("Lint checks passed.");
