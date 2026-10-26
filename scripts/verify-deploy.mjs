/**
 * Deployment readiness checks for Netlify — run in CI after `npm run build`.
 * Validates: netlify.toml wiring, functions present & importable with clean
 * path configs, built bundle present, and no server secrets/env references
 * leaked into the client bundle.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL("..", import.meta.url).pathname;
let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  failures++;
  console.error(`  ✗ ${msg}`);
};

console.log("netlify.toml");
const tomlPath = path.join(ROOT, "netlify.toml");
if (!fs.existsSync(tomlPath)) {
  fail("netlify.toml missing");
} else {
  const toml = fs.readFileSync(tomlPath, "utf8");
  const has = (re, label) => (re.test(toml) ? ok(label) : fail(label));
  has(/\[build\][\s\S]*?command\s*=\s*"npm run build"/, 'build command = "npm run build"');
  has(/\[build\][\s\S]*?publish\s*=\s*"dist"/, 'publish dir = "dist"');
  has(/\[functions\][\s\S]*?directory\s*=\s*"netlify\/functions"/, 'functions directory = "netlify/functions"');
  has(/\[functions\][\s\S]*?node_bundler\s*=\s*"esbuild"/, "functions bundler = esbuild");
  has(/\[\[redirects\]\][\s\S]*?from\s*=\s*"\/\*"/, "SPA fallback redirect present");
}

console.log("\nfunctions");
const fnDir = path.join(ROOT, "netlify/functions");
const expected = ["extract.mjs", "media.mjs", "config.mjs", "jobs.mjs"];
for (const f of expected) {
  const p = path.join(fnDir, f);
  if (!fs.existsSync(p)) {
    fail(`${f} missing`);
    continue;
  }
  try {
    const mod = await import(pathToFileURL(p).href);
    if (typeof mod.default !== "function") throw new Error("no default export");
    if (!mod.config?.path || !mod.config.path.startsWith("/api/")) throw new Error("missing/invalid config.path");
    ok(`${f} imports cleanly → ${mod.config.path}`);
  } catch (e) {
    fail(`${f} failed to import: ${e.message}`);
  }
}

console.log("\nbuilt bundle");
const indexPath = path.join(ROOT, "dist/index.html");
if (!fs.existsSync(indexPath)) {
  fail("dist/index.html missing — run npm run build first");
} else {
  ok("dist/index.html present");
  const assets = fs.existsSync(path.join(ROOT, "dist/assets"))
    ? fs.readdirSync(path.join(ROOT, "dist/assets")).filter((f) => f.endsWith(".js"))
    : [];
  if (!assets.length) fail("no JS bundles in dist/assets");
  else ok(`${assets.length} JS bundle(s) present`);

  // Secret-leak scan: server-only material must never appear client-side.
  const leaks = ["dev-only-insecure-secret", "MEDIA_SIGNING_SECRET", "WORKER_SECRET", "process.env.MEDIA_"];
  for (const a of assets) {
    const code = fs.readFileSync(path.join(ROOT, "dist/assets", a), "utf8");
    for (const needle of leaks) {
      if (code.includes(needle)) fail(`bundle ${a} contains server-only string: ${needle}`);
    }
  }
  ok("no server secrets/env references found in client bundle");
}

console.log("\ngitignore hygiene");
const gi = fs.existsSync(path.join(ROOT, ".gitignore")) ? fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8") : "";
for (const entry of ["node_modules/", "dist/", ".netlify/", ".env"]) {
  gi.split("\n").some((l) => l.trim() === entry || l.trim() === entry.replace(/\/$/, ""))
    ? ok(`ignores ${entry}`)
    : fail(`.gitignore should cover ${entry}`);
}

if (failures) {
  console.error(`\n${failures} deploy check(s) failed`);
  process.exit(1);
}
console.log("\nAll deployment checks passed.");
