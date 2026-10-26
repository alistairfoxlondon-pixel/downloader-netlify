/** Run the Vite dev server and the local functions emulator together. */
import { spawn } from "node:child_process";

// Preview/development: answer quickly with a structured JSON error instead of
// letting any gateway in front of the dev server time out on a silent upstream
// hang (that surfaces to the UI as a bare, unfriendly "HTTP 504").
// Production defaults are unchanged; explicit env values still win.
process.env.FETCH_TIMEOUT_MS ||= "6000";
process.env.MEDIA_FETCH_TIMEOUT_MS ||= "12000";

const procs = [];

function run(name, cmd, args) {
  const p = spawn(cmd, args, { stdio: "inherit", env: process.env });
  p.on("exit", (code) => {
    console.error(`[dev] ${name} exited with code ${code}`);
    shutdown(code ?? 1);
  });
  procs.push(p);
  return p;
}

function shutdown(code = 0) {
  for (const p of procs) {
    if (!p.killed) p.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 200);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("functions", process.execPath, ["scripts/functions-dev-server.mjs"]);
run("vite", process.execPath, ["node_modules/vite/bin/vite.js"]);
