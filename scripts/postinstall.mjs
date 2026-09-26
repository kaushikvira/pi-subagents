#!/usr/bin/env node
// Best-effort dist/ rebuild.
//
// Pi installs git-based extensions with `npm install --omit=dev`, so the
// local `tsc` (a devDependency) is absent. In that case we fall back to the
// committed dist/ that ships in the repo. Full dev installs (with tsc in
// node_modules/.bin) rebuild so the dist matches the checked-out source.
import { execSync } from "node:child_process";

try {
  execSync("npx --no-install tsc", { stdio: "inherit" });
  console.log("pi-subagents: rebuilt dist/ with local tsc");
} catch {
  console.log("pi-subagents: local tsc not available (dev deps omitted); using committed dist/");
}
