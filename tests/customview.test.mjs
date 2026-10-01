// Run the Strata custom view (customview/ with src/) in Chromium against a
// stand-in for Omniscope's view and query API, and check it: it draws, it
// raises no errors, picking a line selects its rows, a missing mandatory
// option says so. Optionally writes screenshots, e.g. the gallery thumbnail.
//
//   node tests/customview.test.mjs [--csv rows.csv] [--shots DIR] [--thumbnail FILE]
//
// Chromium: $CHROME, else /usr/bin/chromium, else puppeteer's own if installed.
// puppeteer-core: from node_modules (npm install), else a global install.
//
// Without --csv it makes up two weeks of lines (seeded, so repeatable) -
// what the public thumbnail should show. With --csv it uses
// a CSV with the view's own fields (Layer, Start, End, Label, Colour, Emphasis, Foot).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const viewDir = path.join(here, "..", "customview"), srcDir = path.join(here, "..", "src");
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

function puppeteerPath() {
  let global = "";
  try { global = execSync("npm root -g", {encoding: "utf8"}).trim(); } catch (e) { /* no npm on the path */ }
  for (const p of ["puppeteer-core", path.join(global, "puppeteer-core")]) {
    try { return require.resolve(p); } catch (e) { /* try the next */ }
  }
  throw new Error("puppeteer-core is not installed: npm install");
}
const puppeteer = require(puppeteerPath());
const chrome = [process.env.CHROME, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(p => p && existsSync(p));
if (!chrome) throw new Error("no Chrome or Chromium found: set CHROME to its path");

// Rows as field -> value, as a table in Omniscope would hold them.
function madeUp() {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const t0 = Date.UTC(2026, 0, 5, 0, 0) / 1000, rows = [];
  const teams = ["Platform", "Billing", "Mobile", "Data", "Support"];
  const stamp = t => new Date(t * 1000).toISOString().slice(0, 19).replace("T", " ");
  for (let i = 0; i < 26; i++) {
    const open = t0 + rand() * 12 * 86400, life = 3600 * (1 + rand() * rand() * 150);
    const team = teams[Math.floor(rand() * teams.length)];
    for (let t = open; t < open + life;) {
      const len = 600 + rand() * 5400, strong = rand();
      const emphasis = strong > 0.85 ? 2 : strong > 0.55 ? 1 : 0;
      rows.push({Layer: "S" + i, Start: stamp(t), End: stamp(Math.min(t + len, open + life)),
                 Label: team + " " + (i + 1), Colour: team, Emphasis: emphasis, Foot: ""});
      t += len;
    }
  }
  // Commits appended from a table of their own: a moment each, no Label,
  // Colour or Emphasis - and first, so a line's name can't come from its first row.
  const commits = [];
  for (const r of rows.filter((r, i) => i % 9 === 0)) {
    commits.push({Layer: r.Layer, Start: r.End, End: r.End, At: r.End, Label: "", Colour: "", Emphasis: "", Foot: ""});
  }
  rows.unshift(...commits);
  for (let t = t0 + 8 * 3600; t < t0 + 14 * 86400; t += 1200 + rand() * 3600) {
    const hour = new Date(t * 1000).getUTCHours();
    if (hour < 8 || hour > 18) continue;
    rows.push({Layer: "", Start: stamp(t), End: stamp(t + 600 + rand() * 1800), Label: "", Colour: "",
               Emphasis: "", Foot: rand() > 0.4 ? "focused" : "elsewhere"});
  }
  return rows;
}
function fromCsv(file) {
  const [head, ...lines] = readFileSync(file, "utf8").trim().split(/\r?\n/);
  const cols = head.split(",");
  const map = {layer: "Layer", start: "Start", end: "End", label: "Label", colour: "Colour",
               emphasis: "Emphasis", foot: "Foot"};
  return lines.map(line => {
    const cells = line.split(",");     // the export writes no commas inside values but in labels... see below
    const row = {};
    cols.forEach((c, i) => { const f = map[c.toLowerCase()]; if (f) row[f] = cells[i]; });   // Layer or layer
    row.Emphasis = row.Emphasis === "" ? "" : Number(row.Emphasis);
    return row;
  });
}

const rows = flag("--csv") ? fromCsv(flag("--csv")) : madeUp();
const OPTIONS = {layer: "Layer", start: "Start", end: "End", label: "Label", colour: "Colour",
                 emphasis: "Emphasis", foot: "Foot", order: "Longest-lived on top", labels: "At the end",
                 workday: true, standup: "09:30",
                 intro: "None"};   // no opening animation: the checks click and measure straight away

// A stand-in for /_global_/customview/v1/omniscope.js.
const mock = `<script>
window.__errors = []; window.__selection = undefined; window.__queries = [];
(function () {
  var rows = ${JSON.stringify(rows)}, handlers = {};
  var context = {options: {items: window.__options || ${JSON.stringify(OPTIONS)}},
                 dataConfig: {filter: null}, manifest: {dataLimit: 50000}, viewSelection: null};
  window.omniscope = {view: {
    on: function (evs, fn) { [].concat(evs).forEach(function (e) { (handlers[e] = handlers[e] || []).push(fn); }); },
    context: function () { return context; },
    busy: function () {}, endpoint: function () { return ""; },
    error: function (m) { window.__errors.push(m); },
    updated: function () { window.__selection = context.viewSelection; },
    whitespaceClick: function () { window.__selection = null; },
    queryBuilder: function () {
      var q, done = {};
      var request = {
        table: function (query) { q = query; return request; },
        on: function (ev, fn) { done[ev] = fn; return request; },
        execute: function () {
          window.__queries.push(q);
          // As the real server: a field asked for twice is refused.
          if (new Set(q.fields).size !== q.fields.length) {
            setTimeout(function () { done.error({data: {message: "Some fields are duplicated: " + q.fields}}); }, 0);
            return;
          }
          // A filter on what the lines are (window.__keep: the Layers that
          // pass) leaves the foot line's rows, which have no Layer, as they are.
          var passing = !window.__keep ? rows : rows.filter(function (r) { return !r.Layer || window.__keep.indexOf(r.Layer) >= 0; });
          // window.__utc: dates as the real server sends them, "2026-01-05T08:00:00Z".
          if (window.__utc) passing = passing.map(function (r) {
            var z = function (v) { return v ? v.replace(" ", "T") + "Z" : v; };
            return Object.assign({}, r, {Start: z(r.Start), End: z(r.End), At: z(r.At)});
          });
          // window.__bare: Layers a filter on the stretches took all the stretches of, not the commits.
          if (window.__bare) passing = passing.filter(function (r) { return window.__bare.indexOf(r.Layer) < 0 || r.At; });
          // window.__atOnly: commits appended with their time alone (Moment time), no Start or End.
          if (window.__atOnly) passing = passing.map(function (r) { return r.At ? Object.assign({}, r, {Start: "", End: ""}) : r; });
          var records = passing.map(function (r) { return q.fields.map(function (f) { return r[f]; }); });
          setTimeout(function () { done.load({data: {records: records, schema: {fields: q.fields}}}); }, 0);
        }
      };
      return request;
    }
  }};
  window.__fire = function (ev) { (handlers[ev] || []).forEach(function (fn) { fn({data: context}); }); };
  window.addEventListener("load", function () { setTimeout(function () { window.__fire("load"); }, 0); });
})();
</script>`;

const dir = mkdtempSync(path.join(tmpdir(), "strata-view-"));
for (const f of ["strata-cloth.js", "strata-view.js", "strata-ui.js"]) copyFileSync(path.join(srcDir, f), path.join(dir, f));
const html = readFileSync(path.join(viewDir, "index.html"), "utf8")
  .replace('<script src="/_global_/customview/v1/omniscope.js"></script>', mock);
// The view's place, readable by the checks.
writeFileSync(path.join(dir, "index.html"), html.replace("loaded = true;", "loaded = true; window.__ui = ui;"));
writeFileSync(path.join(dir, "missing.html"), html.replace("window.__errors = [];",
  'window.__errors = []; window.__options = {start: "Start", end: "End"};'));
// Two settings on one field - Label and Colour both the Colour field.
// Filtered to the lines that close within the first four days.
const firstDays = (() => {
  const t0 = Math.min(...rows.filter(r => r.Layer).map(r => Date.parse(r.Start.replace(" ", "T") + "Z")));
  const last = {};
  for (const r of rows) if (r.Layer) last[r.Layer] = Math.max(last[r.Layer] || 0, Date.parse(r.End.replace(" ", "T") + "Z"));
  return Object.keys(last).filter(k => last[k] < t0 + 4 * 86400e3);
})();
writeFileSync(path.join(dir, "filtered.html"), html.replace("window.__errors = [];",
  "window.__errors = []; window.__keep = " + JSON.stringify(firstDays) + ";"));
// No Foot line field: the foot line drawn from the lines.
const noFoot = {...OPTIONS}; delete noFoot.foot;
writeFileSync(path.join(dir, "nofoot.html"), html.replace("window.__errors = [];",
  "window.__errors = []; window.__options = " + JSON.stringify(noFoot) + ";"));
writeFileSync(path.join(dir, "momentat.html"), html.replace("window.__errors = [];",
  "window.__errors = []; window.__atOnly = true; window.__options = " + JSON.stringify({...OPTIONS, momentAt: "At"}) + ";"));
const bare = [...new Set(rows.filter(r => r.At).map(r => r.Layer))].slice(0, 3);
writeFileSync(path.join(dir, "bare.html"), html.replace("window.__errors = [];",
  "window.__errors = []; window.__bare = " + JSON.stringify(bare) + ";"));
writeFileSync(path.join(dir, "utc.html"), html.replace("window.__errors = [];", "window.__errors = []; window.__utc = true;"));
writeFileSync(path.join(dir, "flipped.html"), html.replace("window.__errors = [];",
  "window.__errors = []; window.__options = " + JSON.stringify({...OPTIONS, order: "Longest-lived at the bottom"}) + ";"));
writeFileSync(path.join(dir, "shared.html"), html.replace("window.__errors = [];",
  "window.__errors = []; window.__options = " + JSON.stringify({...OPTIONS, label: "Colour"}) + ";"));

const browser = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"], headless: "new"});
const failures = [];
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failures.push(what); };
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", e => pageErrors.push(e.message));
  await page.setViewport({width: 1200, height: 560});
  await page.goto("file://" + path.join(dir, "index.html"), {waitUntil: "load"});
  await page.waitForSelector("path.line", {timeout: 5000});
  const state = await page.evaluate(() => ({errors: window.__errors, query: window.__queries[0],
                                            lines: document.querySelectorAll("path.line").length,
                                            labels: document.querySelectorAll("text.lab").length}));
  check(!pageErrors.length && !state.errors.length, "no errors " + JSON.stringify(pageErrors.concat(state.errors)));
  check(state.lines > 0, state.lines + " lines drawn, " + state.labels + " labelled");
  const marked = await page.evaluate(() => ({pinches: document.querySelectorAll("g.pinch").length,
    named: [...document.querySelectorAll("text.lab, .lab")].map(t => t.textContent).filter(t => /^S\d+$/.test(t))}));
  check(marked.pinches > 0 && !marked.named.length, marked.pinches + " commits marked, appended rows without a label;"
        + " no line named by its key");
  check(state.query && !("@visokiotype" in state.query) && state.query.fields.length === 7
        && "filter" in state.query && !("filters" in state.query),
        "one plain query for the seven chosen fields, through the report's filter");
  // Pick a line: its rows become the selection, for other views to brush.
  const grab = await page.$("path.grab");
  await grab.evaluate(el => el.dispatchEvent(new MouseEvent("click", {bubbles: true})));
  const picked = await page.evaluate(() => window.__selection);
  check(picked && picked.filters && picked.filters[0].inputField === "Layer", "picking a line selects its rows");
  // Grab the chart and drag it: it scrolls, and the drag selects nothing.
  await page.evaluate(() => { window.__selection = "untouched"; });
  const leftBefore = await page.evaluate(() => document.querySelector(".scroller").scrollLeft);
  const box = await (await page.$(".scroller")).boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width / 2 + 20 * i, y);
  await page.mouse.up();
  const dragged = await page.evaluate(() => ({left: document.querySelector(".scroller").scrollLeft,
                                            selection: window.__selection}));
  check(dragged.left < leftBefore && dragged.selection === "untouched",
        "dragging the chart scrolls it (" + leftBefore + " to " + dragged.left + ") and selects nothing");
  // Drag, pause, let go: it stays put. Flick and let go: it coasts on.
  const settle = async () => {
    await new Promise(r => setTimeout(r, 400));
    return page.evaluate(() => document.querySelector(".scroller").scrollLeft);
  };
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + box.width / 2 - 15 * i, y);
  await new Promise(r => setTimeout(r, 250));
  const paused = await page.evaluate(() => document.querySelector(".scroller").scrollLeft);
  await page.mouse.up();
  check(await settle() === paused, "drag, pause, let go: it stays where it was put");
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + box.width / 2 + 30 * i, y);
  const flicked = await page.evaluate(() => document.querySelector(".scroller").scrollLeft);
  await page.mouse.up();
  check(await settle() < flicked, "a flick coasts on after letting go");
  const shots = flag("--shots");
  if (shots) {
    await page.screenshot({path: path.join(shots, "strata-view.png")});
    console.log("wrote " + path.join(shots, "strata-view.png"));
  }
  const thumb = flag("--thumbnail");
  if (thumb) {
    // The whole range at once, in a square: 400 px drawn at 290.
    await page.setViewport({width: 400, height: 400, deviceScaleFactor: 290 / 400});
    // No labels, and zoomed partway in: the layers are the picture.
    await page.evaluate(() => { omniscope.view.context().options.items.labels = "None"; window.__fire("update"); });
    await page.waitForSelector("path.line");
    await page.evaluate(() => {
      const zoom = document.querySelector(".zoom input");
      zoom.value = 220; zoom.dispatchEvent(new Event("input"));
    });
    await new Promise(r => setTimeout(r, 200));
    await page.screenshot({path: thumb, clip: {x: 0, y: 0, width: 400, height: 400}});
    console.log("wrote " + thumb);
  }
  const shared = await browser.newPage();
  await shared.goto("file://" + path.join(dir, "shared.html"), {waitUntil: "load"});
  await shared.waitForSelector("path.line", {timeout: 5000});
  const sharedState = await shared.evaluate(() => ({errors: window.__errors, fields: window.__queries[0].fields}));
  check(!sharedState.errors.length && sharedState.fields.length === 6,
        "two settings on one field ask for it once: " + JSON.stringify(sharedState.fields));
  // A short pane: the shortest lines crowding it are left out, and it says so.
  const short = await browser.newPage();
  await short.setViewport({width: 1200, height: 240});
  await short.goto("file://" + path.join(dir, "index.html"), {waitUntil: "load"});
  await short.waitForSelector("path.line", {timeout: 5000});
  const fit = await short.evaluate(() => {
    const chart = document.querySelector(".chart").getBoundingClientRect();
    return {note: document.querySelector(".left-out").textContent, bottom: chart.bottom, height: innerHeight};
  });
  check(/left out to fit/.test(fit.note) && fit.bottom <= fit.height,
        "a short pane fits: " + JSON.stringify(fit.note) + ", chart ends at " + Math.round(fit.bottom) + " of "
        + fit.height);
  if (shots) await short.screenshot({path: path.join(shots, "strata-view-short.png")});
  // A tall pane: filled - the foot at its bottom - with the layers as they
  // were, only more headroom above them.
  const layerGaps = p => p.evaluate(() => {
    const foot = document.querySelector("line.base").getBoundingClientRect().top;
    const tops = [...document.querySelectorAll("path.line")].map(l => Math.round(foot - l.getBoundingClientRect().bottom));
    return {tops: tops.sort((x, y) => x - y).slice(0, 5).join(","), bottom: document.querySelector(".chart")
      .getBoundingClientRect().bottom, height: innerHeight};
  });
  const before = await layerGaps(page);
  const tall = await browser.newPage();
  await tall.setViewport({width: 1200, height: 1000});
  await tall.goto("file://" + path.join(dir, "index.html"), {waitUntil: "load"});
  await tall.waitForSelector("path.line", {timeout: 5000});
  const after = await layerGaps(tall);
  if (shots) await tall.screenshot({path: path.join(shots, "strata-view-tall.png")});
  check(after.bottom > after.height - 40 && after.bottom <= after.height && after.tops === before.tops,
        "a tall pane is filled, layers unmoved: chart ends at " + Math.round(after.bottom) + " of " + after.height
        + "; lowest lines above the foot " + after.tops + " (were " + before.tops + ")");
  // Filtered to a few lines: the chart spans their days, not the foot line's.
  const widthOf = async file => {
    const p = await browser.newPage();
    await p.setViewport({width: 1200, height: 560});
    await p.goto("file://" + path.join(dir, file), {waitUntil: "load"});
    await p.waitForSelector("path.line", {timeout: 5000});
    return p.$eval(".chart", c => +c.getAttribute("width"));
  };
  const whole = await widthOf("index.html"), narrowed = await widthOf("filtered.html");
  check(firstDays.length > 1 && narrowed < whole * 0.6,
        "a filter to " + firstDays.length + " lines narrows the chart to their days: " + narrowed + " px wide, "
        + "unfiltered " + whole);
  // The foot line: from the Foot rows, or without that field, from the lines.
  const feet = async file => {
    const p = await browser.newPage();
    await p.setViewport({width: 1200, height: 560});
    await p.goto("file://" + path.join(dir, file), {waitUntil: "load"});
    await p.waitForSelector("path.line", {timeout: 5000});
    return p.evaluate(() => ({foot1: document.querySelectorAll("line.foot-1").length,
                              foot2: document.querySelectorAll("line.foot-2").length,
                              fields: window.__queries[0].fields.length, errors: window.__errors}));
  };
  const appended = await feet("index.html"), auto = await feet("nofoot.html");
  check(appended.foot1 > 0 && appended.foot2 > 0 && auto.foot1 > 0 && auto.foot2 === 0 && auto.fields === 6
        && !auto.errors.length,
        "without a Foot line field the foot line is drawn from the lines: " + JSON.stringify(auto)
        + "; with it, " + JSON.stringify(appended));
  // Commits with a Moment time and no Start or End: marked all the same.
  const atOnly = await browser.newPage();
  await atOnly.setViewport({width: 1200, height: 560});
  await atOnly.goto("file://" + path.join(dir, "momentat.html"), {waitUntil: "load"});
  await atOnly.waitForSelector("path.line", {timeout: 5000});
  const atMarks = await atOnly.evaluate(() => ({pinches: document.querySelectorAll("g.pinch").length, errors: window.__errors}));
  check(atMarks.pinches === marked.pinches && !atMarks.errors.length,
        "commits with a Moment time and no Start or End are marked the same: " + atMarks.pinches);
  // Commits left by a filter without their line's stretches: no line of their own.
  const barePage = await browser.newPage();
  await barePage.setViewport({width: 1200, height: 560});
  await barePage.goto("file://" + path.join(dir, "bare.html"), {waitUntil: "load"});
  await barePage.waitForSelector("path.line", {timeout: 5000});
  const bareState = await barePage.evaluate(b => ({
    drawn: [...document.querySelectorAll("path.grab")].filter(p => b.includes(p.dataset.name)).length,
    errors: window.__errors}), bare);
  check(bareState.drawn === 0 && !bareState.errors.length,
        "commits whose stretches a filter removed draw no line of their own (" + bare.length + " sessions)");
  // Dates as Omniscope sends them (UTC), read in New York and in Tokyo: the
  // same clock times, so the same days, as the data says.
  const firstDay = rows.filter(r => r.Layer && r.Start !== r.End).map(r => r.Start).sort()[0].slice(0, 10);
  const days = [];
  for (const zone of ["America/New_York", "Asia/Tokyo"]) {
    const z = await browser.newPage();
    await z.emulateTimezone(zone);
    await z.setViewport({width: 1200, height: 560});
    await z.goto("file://" + path.join(dir, "utc.html"), {waitUntil: "load"});
    await z.waitForSelector("path.line", {timeout: 5000});
    await z.evaluate(async () => {
      const zoom = document.querySelector(".zoom input"); zoom.value = "0"; zoom.dispatchEvent(new Event("input"));
      await new Promise(r => setTimeout(r, 400));
    });
    days.push(await z.$eval("text.daylab", t => t.textContent));
  }
  const want = String(+firstDay.slice(8, 10));
  check(days.every(d => d.split(" ").includes(want)),
        "dates sent as UTC show their own clock times anywhere: first day " + JSON.stringify(days) + ", the data's "
        + firstDay);
  // Longest-lived at the bottom: the first laid, the lowest, is the longest.
  const flipped = await browser.newPage();
  await flipped.setViewport({width: 1200, height: 560});
  await flipped.goto("file://" + path.join(dir, "flipped.html"), {waitUntil: "load"});
  await flipped.waitForSelector("path.line", {timeout: 5000});
  const spans = await flipped.evaluate(async () => {
    const zoom = document.querySelector(".zoom input");
    zoom.value = "0"; zoom.dispatchEvent(new Event("input"));
    await new Promise(r => setTimeout(r, 400));
    const by = {};
    for (const l of document.querySelectorAll("path.line[data-index]")) {
      const r = l.getBoundingClientRect(), i = +l.dataset.index;
      by[i] = [Math.min(r.left, (by[i] || [Infinity])[0]), Math.max(r.right, (by[i] || [0, -Infinity])[1])];
    }
    return Object.keys(by).map(i => [+i, by[i][1] - by[i][0]]);
  });
  const widest = spans.reduce((a, b) => b[1] > a[1] ? b : a);
  check(spans.length > 5 && widest[0] === 0,
        "longest-lived at the bottom: the bottom line is the widest (" + Math.round(widest[1]) + " px)");
  // A filter changes: the zoom and the place are kept.
  const where = p => p.evaluate(() => {
    const s = document.querySelector(".scroller");
    return {zoom: +document.querySelector(".zoom input").value, left: Math.round(s.scrollLeft),
            atEnd: s.scrollLeft + s.clientWidth >= s.scrollWidth - 4, errors: window.__errors};
  });
  const refilter = async (p, keep) => {
    await p.evaluate(k => { window.__keep = k; window.__fire("update"); }, keep);
    await new Promise(r => setTimeout(r, 400));
    return where(p);
  };
  const kept = await browser.newPage();
  await kept.setViewport({width: 1200, height: 560});
  await kept.goto("file://" + path.join(dir, "index.html"), {waitUntil: "load"});
  await kept.waitForSelector("path.line", {timeout: 5000});
  const atEnd = await refilter(kept, firstDays);
  check(atEnd.atEnd && !atEnd.errors.length, "a filter keeps the screen at the end it was at");
  const everyLayer = [...new Set(rows.filter(r => r.Layer).map(r => r.Layer))];
  await kept.evaluate(async () => {
    const zoom = document.querySelector(".zoom input");
    zoom.value = "600"; zoom.dispatchEvent(new Event("input"));
    await new Promise(r => setTimeout(r, 300));
    const s = document.querySelector(".scroller");
    s.scrollLeft = s.scrollWidth / 3; s.dispatchEvent(new Event("scroll"));
    await new Promise(r => setTimeout(r, 300));
  });
  const placeOf = () => kept.evaluate(() => window.__ui.state());
  const before2 = await placeOf();
  await refilter(kept, everyLayer);
  const after2 = await placeOf(), shown = await where(kept);
  const day = t => new Date(t * 1000).toISOString().slice(0, 16);
  check(before2.pin === "middle" && Math.abs(after2.zoom - before2.zoom) < 0.002
        && Math.abs(after2.t - before2.t) < 600 && !shown.atEnd && !shown.errors.length,
        "a wider filter keeps the zoom's share (" + before2.zoom.toFixed(2) + ") and the moment on screen: "
        + day(before2.t) + " -> " + day(after2.t));
  const missing = await browser.newPage();
  await missing.goto("file://" + path.join(dir, "missing.html"), {waitUntil: "load"});
  await new Promise(r => setTimeout(r, 300));
  const said = await missing.$eval("#message", el => el.textContent);
  check(/Layer/.test(said), "a missing Layer says so: " + JSON.stringify(said));
} finally {
  await browser.close();
}
if (failures.length) { console.log(failures.length + " FAILED"); process.exit(1); }
console.log("All checks passed.");
