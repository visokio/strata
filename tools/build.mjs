// Assemble the Omniscope custom view: customview/ plus the three scripts from
// src/, into dist/customview/strata/ - the folder the gallery takes as it is.
//
//   node tools/build.mjs                          (npm run build)
//   node tools/build.mjs --to ../omniscope-custom-views/strata
//
// --to also copies the folder there (a checkout of visokio/omniscope-custom-views),
// replacing the files it holds, so the gallery's copy is always this build.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist", "customview", "strata");
const SCRIPTS = ["strata-cloth.js", "strata-view.js", "strata-ui.js"];

rmSync(out, {recursive: true, force: true});
mkdirSync(out, {recursive: true});
// Each file read and written whole, rather than copied: Node's copy, over an
// existing file in a folder shared with another machine (a container's mount),
// can fail part way and leave the file empty and unreadable.
/** @param {string} from @param {string} to */
const copy = (from, to) => writeFileSync(to, readFileSync(from));
for (const f of readdirSync(path.join(root, "customview"))) copy(path.join(root, "customview", f), path.join(out, f));
for (const f of SCRIPTS) copy(path.join(root, "src", f), path.join(out, f));
console.log("built " + path.relative(root, out) + ": " + readdirSync(out).sort().join(", "));

const i = process.argv.indexOf("--to");
if (i >= 0) {
  const to = path.resolve(process.argv[i + 1]);
  if (!existsSync(path.dirname(to))) throw new Error("no such folder: " + path.dirname(to));
  // Only the files this build makes are replaced; anything else there (a test.ioz
  // made in Omniscope) stays.
  mkdirSync(to, {recursive: true});
  for (const f of readdirSync(out)) copy(path.join(out, f), path.join(to, f));
  console.log("copied to " + to);
}
