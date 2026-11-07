// Assemble the Omniscope custom view: customview/ (with its folders: the gallery's
// tests, sample data and showcase) plus the three scripts from src/, into
// dist/customview/strata/ - the folder the gallery takes as it is.
//
//   node tools/build.mjs                          (npm run build)
//   node tools/build.mjs --to ../omniscope-custom-views/strata
//
// --to also copies the folder there (a checkout of visokio/omniscope-custom-views),
// replacing the files it holds, so the gallery's copy is always this build.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync, statSync } from "node:fs";
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
/** A folder's files, and those of the folders in it, into another. @param {string} from @param {string} to */
function copyAll(from, to) {
  mkdirSync(to, {recursive: true});
  for (const f of readdirSync(from)) {
    if (f === ".DS_Store") continue;
    if (statSync(path.join(from, f)).isDirectory()) copyAll(path.join(from, f), path.join(to, f));
    else copy(path.join(from, f), path.join(to, f));
  }
}
copyAll(path.join(root, "customview"), out);
for (const f of SCRIPTS) copy(path.join(root, "src", f), path.join(out, f));
console.log("built " + path.relative(root, out) + ": " + readdirSync(out).sort().join(", "));

const i = process.argv.indexOf("--to");
if (i >= 0) {
  const to = path.resolve(process.argv[i + 1]);
  if (!existsSync(path.dirname(to))) throw new Error("no such folder: " + path.dirname(to));
  // Only the files this build makes are replaced; anything else there (the demo.ioz
  // made in Omniscope) stays.
  copyAll(out, to);
  console.log("copied to " + to);
}
