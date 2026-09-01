#!/usr/bin/env node
// Proves the published tarball installs and runs with no build step and no
// devDependencies present — the guarantee `docs/RELEASE-CONTRACT.md` states.
// Runs without --ignore-scripts: better-sqlite3's own install script is what
// fetches its prebuild, and suppressing it would break the CLI for a reason
// unrelated to the guarantee this check exists to catch.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function run(label, command, args, options = {}) {
  console.log(`==> ${label}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: false, ...options });
  if (result.error || result.status !== 0) {
    if (result.error) console.error(`Tarball install smoke failed: ${label}: ${result.error.message}`);
    else console.error(`Tarball install smoke failed: ${label}`);
    process.exit(result.status ?? 1);
  }
  return result;
}

function runCapture(label, command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: false, ...options });
  if (result.error || result.status !== 0) {
    if (result.error) console.error(`Tarball install smoke failed: ${label}: ${result.error.message}`);
    else console.error(`Tarball install smoke failed: ${label}`);
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result;
}

const packDest = mkdtempSync(join(tmpdir(), "qmd-pack-"));
const scratchDir = mkdtempSync(join(tmpdir(), "qmd-install-"));

try {
  console.log(`==> Packing tarball into ${packDest}`);
  const packResult = runCapture("npm pack", "npm", ["pack", "--silent", "--pack-destination", packDest], { cwd: root });
  const tarballName = packResult.stdout.trim().split("\n").pop();
  const tarballPath = join(packDest, tarballName);

  console.log("==> Checking packed manifest for install-time lifecycle scripts");
  const manifestRaw = runCapture("read packed package.json", "tar", ["-xOzf", tarballPath, "package/package.json"]).stdout;
  const manifest = JSON.parse(manifestRaw);
  const forbidden = ["preinstall", "install", "postinstall"];
  const declared = forbidden.filter((name) => manifest.scripts?.[name]);
  if (declared.length > 0) {
    console.error(`Tarball install smoke failed: packed manifest declares install-time lifecycle script(s): ${declared.join(", ")}`);
    process.exit(1);
  }

  // A scratch target outside the repo tree, so Node resolution can never fall
  // back to this repo's own node_modules and mask a real regression.
  console.log(`==> Installing packed tarball into ${scratchDir}`);
  run("npm init", "npm", ["init", "--yes"], { cwd: scratchDir, stdio: "ignore" });
  run("npm install (packed tarball, --omit=dev)", "npm", ["install", tarballPath, "--omit=dev"], { cwd: scratchDir });

  const installedBin = join(scratchDir, "node_modules", ".bin", "qmd");
  run("installed CLI runs", installedBin, ["--version"], { cwd: scratchDir });

  console.log("==> Tarball install smoke passed");
} finally {
  rmSync(packDest, { recursive: true, force: true });
  rmSync(scratchDir, { recursive: true, force: true });
}
