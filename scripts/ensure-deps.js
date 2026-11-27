// Dependency preflight for `npm run dev`. Uses only Node built-ins so it works
// even when node_modules is missing or stale (e.g. copied from another PC).
// If any direct dependency is missing or differs from package-lock.json, it
// runs `npm install`, and stops with instructions if that is not enough.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));

function findProblems() {
  const pkg = readJson("package.json");
  let lock = null;
  try {
    lock = readJson("package-lock.json");
  } catch {
    // no lockfile: only check that packages exist
  }
  const problems = [];
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    let installed = null;
    try {
      installed = readJson(path.join("node_modules", name, "package.json")).version;
    } catch {
      // missing
    }
    const expected = lock?.packages?.[`node_modules/${name}`]?.version;
    if (!installed) problems.push(`${name} (missing)`);
    else if (expected && installed !== expected) problems.push(`${name} ${installed} -> ${expected}`);
  }
  return problems;
}

function runNpm(command) {
  console.info(`Running npm ${command}...`);
  const npmCli = process.env.npm_execpath;
  const result = npmCli
    ? spawnSync(process.execPath, [npmCli, command], { cwd: root, stdio: "inherit" })
    : spawnSync(`npm ${command}`, { cwd: root, stdio: "inherit", shell: true });
  if (result.status !== 0) {
    console.error(`npm ${command} failed. Fix the error above, then rerun npm run dev.`);
    process.exit(result.status || 1);
  }
}

let problems = findProblems();
if (problems.length) {
  console.info(`Installed packages do not match package-lock.json: ${problems.join(", ")}.`);
  runNpm("install");
  problems = findProblems();
  if (problems.length) {
    // Not running `npm ci` automatically: on Windows it deletes node_modules
    // first and fails midway if a running dev server has files locked.
    console.error(`Packages are still out of date: ${problems.join(", ")}.`);
    console.error("Stop any running dev servers, delete the node_modules folder, run npm install, then rerun npm run dev.");
    process.exit(1);
  }
}
