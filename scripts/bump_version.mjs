#!/usr/bin/env node
// Set the package version everywhere it is authoritative.
//
// Only three places carry a version that must agree: package.json, the root
// metadata of package-lock.json (two spots), and the fallback string in
// lib/paths.mjs. Profile and model files carry their own content versions and
// are deliberately left alone.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

export function bumpVersion(next, { dryRun = false, rootDir = root } = {}) {
  if (!semver.test(String(next))) throw new Error(`not a semantic version: ${next}`);
  const changes = [];

  const pkgPath = path.join(rootDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  if (pkg.version !== next) changes.push(["package.json", pkg.version, next]);

  const lockPath = path.join(rootDir, "package-lock.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const lockRoot = lock.packages?.[""] || {};
  if (lock.version !== next || lockRoot.version !== next) changes.push(["package-lock.json", `${lock.version}/${lockRoot.version}`, next]);

  const pathsPath = path.join(rootDir, "lib", "paths.mjs");
  const pathsSrc = fs.readFileSync(pathsPath, "utf8");
  const fallback = pathsSrc.match(/PKG\.version \|\| "([^"]+)"/);
  if (!fallback) throw new Error("lib/paths.mjs: VERSION fallback not found");
  if (fallback[1] !== next) changes.push(["lib/paths.mjs", fallback[1], next]);

  if (!dryRun) {
    if (changes.some(([file]) => file === "package.json")) {
      pkg.version = next;
      fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    }
    if (changes.some(([file]) => file === "package-lock.json")) {
      lock.version = next;
      if (lock.packages?.[""]) lock.packages[""].version = next;
      fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    }
    if (changes.some(([file]) => file === "lib/paths.mjs")) {
      fs.writeFileSync(pathsPath, pathsSrc.replace(/PKG\.version \|\| "[^"]+"/, `PKG.version || "${next}"`));
    }
  }
  return changes;
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  const next = process.argv[2];
  if (!next) {
    process.stderr.write("usage: node scripts/bump_version.mjs <version> [--dry-run]\n");
    process.exit(2);
  }
  const changes = bumpVersion(next, { dryRun: process.argv.includes("--dry-run") });
  if (!changes.length) process.stdout.write(`version: already ${next}\n`);
  for (const [file, from, to] of changes) process.stdout.write(`version: ${file} ${from} -> ${to}\n`);
}
