// Unit tests for the Strata layout (strata-cloth.js) and drawing
// (strata-view.js). Run: npm test (node --test tests/strata.test.mjs).
// Types: npm run typecheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Cloth = require("../src/strata-cloth.js");
const View = require("../src/strata-view.js");

const PARAMS = { gap: 30, radius: 12, soften: 6 };
const COLUMNS = 400, SPP = 60;           // 400 px, a minute each
const at = px => px * SPP;              // seconds at a pixel column
const span = (a, b) => ({ start: at(a), end: at(b) });

function heightAt(layer, k) {
  return layer.ys[k - layer.k0];
}

test("the first layer lies flat on the floor", () => {
  const [only] = Cloth.drape([span(0, 400)], COLUMNS, SPP, PARAMS);
  assert.equal(only.k0, 0);
  assert.ok(only.ys.every(v => v === 0));
});

test("a layer never comes closer than the gap to the one beneath", () => {
  const laid = Cloth.drape([span(50, 250), span(0, 400), span(100, 300)], COLUMNS, SPP, PARAMS);
  for (let upper = 1; upper < laid.length; upper++) {
    for (let lower = 0; lower < upper; lower++) {
      for (let k = 0; k <= COLUMNS; k++) {
        const u = heightAt(laid[upper], k), l = heightAt(laid[lower], k);
        if (u === undefined || l === undefined) continue;
        assert.ok(u - l >= PARAMS.gap - 1e-9, `layer ${upper} at ${k} is ${u - l} above layer ${lower}`);
      }
    }
  }
});

test("where the layer beneath ends, the one above drapes down to what is left", () => {
  const [, upper] = Cloth.drape([span(0, 150), span(0, 400)], COLUMNS, SPP, PARAMS);
  assert.ok(Math.abs(heightAt(upper, 100) - PARAMS.gap) < 1e-9);   // resting on it
  assert.ok(heightAt(upper, 250) < 1e-6);                 // on the floor once it is gone
  for (let k = 1; k <= COLUMNS; k++) {                    // and it falls, not jumps
    assert.ok(Math.abs(heightAt(upper, k) - heightAt(upper, k - 1)) < PARAMS.gap / 2, `jump at ${k}`);
  }
});

test("a layer cut short ends on the curve it was following", () => {
  const below = span(0, 150);
  const [, long] = Cloth.drape([below, span(0, 400)], COLUMNS, SPP, PARAMS);
  const [, short] = Cloth.drape([below, span(0, 160)], COLUMNS, SPP, PARAMS);
  for (let k = 0; k < short.ys.length; k++) assert.equal(short.ys[k], long.ys[k]);
});

test("a brief overlap stacks at every zoom, and a mere touch at none", () => {
  // Two real lines that overlapped by 1m49s.
  const earlier = {start: 3000, end: 6000}, overlapping = {start: 5891, end: 9000};
  const touching = {start: 6000, end: 9000};
  for (let spp = 7; spp < 900; spp *= 1.07) {
    const columns = Math.ceil(12000 / spp);
    const [, over] = Cloth.drape([earlier, overlapping], columns, spp, PARAMS);
    const [, touch] = Cloth.drape([earlier, touching], columns, spp, PARAMS);
    assert.ok(over.ys[0] >= PARAMS.gap - 1e-9, `no stacking at ${spp.toFixed(1)} s a pixel`);
    assert.ok(Math.max(...touch.ys) < 1e-9, `stacked on a touch at ${spp.toFixed(1)} s a pixel`);
  }
});

test("a layer beneath starting just after one ends lifts its end alike at every zoom", () => {
  // As the real 26 and 12: one ends, and six minutes later a brief one starts.
  const ahead = {start: 6360, end: 6500}, ending = {start: 3000, end: 6000};
  const ends = [];
  for (let spp = 150; spp < 900; spp *= 1.03) {
    const [, upper] = Cloth.drape([ahead, ending], Math.ceil(12000 / spp), spp, PARAMS);
    ends.push(upper.ys[upper.ys.length - 1]);
  }
  assert.ok(Math.max(...ends) - Math.min(...ends) < 8, `its end ranges ${Math.min(...ends)} to ${Math.max(...ends)}`);
});

test("a layer starts resting on what is beneath it then", () => {
  const [, upper] = Cloth.drape([span(0, 400), span(200, 400)], COLUMNS, SPP, PARAMS);
  assert.equal(upper.k0, 200);
  assert.ok(Math.abs(upper.ys[0] - PARAMS.gap) < 1e-9);
});

test("a narrow valley beneath is bridged, not followed", () => {
  const laid = Cloth.drape([span(0, 100), span(103, 400), span(0, 400)], COLUMNS, SPP, PARAMS);
  const top = laid[2];
  for (let k = 100; k <= 103; k++) assert.ok(heightAt(top, k) > 0.8 * PARAMS.gap, `sags to ${heightAt(top, k)} at ${k}`);
});

test("softening leaves a level line level", () => {
  assert.ok(Cloth.soften([5, 5, 5, 5, 5, 5], 6).every(v => Math.abs(v - 5) < 1e-12));
});

// The layout as first written: each column searches out as far as a bend can
// reach, and the floor is laid across every column for every layer. Slow, and
// plainly right - the fast one must give the same cloth.
function searchedDrape(segs, columns, spp, { gap, radius, soften }) {
  const highest = new Float64Array(columns + 1).fill(NaN), reachSoft = Math.trunc(3 * soften);
  const floor = new Float64Array(columns + 1), out = [];
  const restingOn = (seg, k) => {
    let during = 0, after = 0;
    out.forEach((layer, i) => {
      if (k < layer.k0 || k >= layer.k0 + layer.ys.length) return;
      const y = layer.ys[k - layer.k0] + gap;
      if (segs[i].start >= seg.end) after = Math.max(after, y);
      else if (seg.start < segs[i].end) during = Math.max(during, y);
    });
    return [during, after];
  };
  for (const seg of segs) {
    const [first, last] = Cloth.columnsOf(seg, columns, spp);
    for (let k = 0; k <= columns; k++) floor[k] = isNaN(highest[k]) ? 0 : highest[k] + gap;
    floor[first] = restingOn(seg, first)[0];
    const [during, after] = restingOn(seg, last);
    floor[last] = during;
    if (last < columns && after > floor[last + 1]) floor[last + 1] = after;
    for (let k = 0; k < first; k++) floor[k] = floor[first];
    const a = Math.max(0, first - reachSoft), b = Math.min(columns, last + reachSoft);
    let top = -Infinity, bottom = Infinity;
    for (let k = first; k <= columns; k++) top = Math.max(top, floor[k]);
    for (let k = a; k <= b; k++) bottom = Math.min(bottom, floor[k]);
    const reach = top > bottom ? Math.trunc(Math.sqrt(2 * radius * (top - bottom))) + 1 : 0;
    const rounded = [];
    for (let i = a; i <= b; i++) {
      let best = floor[i];
      for (let d = 1; d <= reach; d++) {
        const fall = d * d / (2 * radius);
        if (i - d >= 0) best = Math.max(best, floor[i - d] - fall);
        if (i + d <= columns) best = Math.max(best, floor[i + d] - fall);
      }
      rounded.push(best);
    }
    const softened = Cloth.soften(rounded, soften), ys = new Float64Array(last - first + 1);
    for (let k = first; k <= last; k++) ys[k - first] = Math.max(floor[k], softened[k - a]);
    out.push({ k0: first, ys });
    for (let k = first; k <= last; k++) if (isNaN(highest[k]) || ys[k - first] > highest[k]) highest[k] = ys[k - first];
  }
  return out;
}

test("the layout is the same cloth as a plain search would lay, at every zoom", () => {
  let seed = 11;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let trial = 0; trial < 12; trial++) {
    const range = 86400 * (1 + random() * 10), segs = [];
    for (let i = 0; i < 10 + random() * 60; i++) {
      const s = random() * range;
      segs.push({ start: s, end: Math.min(range, s + random() ** 3 * range) });
    }
    segs.sort((p, q) => (p.end - p.start) - (q.end - q.start));
    for (const dayPx of [20, 150, 900]) {
      const columns = Math.max(1, Math.round(dayPx * range / 86400)), spp = range / columns;
      for (const params of [PARAMS, { gap: 13, radius: 40, soften: 2 }, { gap: 30, radius: 0.3, soften: 0.5 }]) {
        const fast = Cloth.drape(segs, columns, spp, params), slow = searchedDrape(segs, columns, spp, params);
        fast.forEach((layer, i) => {
          assert.equal(layer.k0, slow[i].k0);
          layer.ys.forEach((y, k) => assert.ok(Math.abs(y - slow[i].ys[k]) < 1e-9, `trial ${trial} layer ${i} column ${k}`));
        });
      }
    }
  }
});

test("each pixel shows the strongest state in it: strong, then medium, then faint", () => {
  const pieces = View.pixelStates(0, 10, [[4.1, 4.2]], [[2, 7]]);
  const at = x => pieces.find(([a, b]) => a <= x && x < b)[2];
  assert.equal(at(0.5), 0);        // faint
  assert.equal(at(2.5), 1);        // medium
  assert.equal(at(4.5), 2);        // a tenth of a pixel of strong still takes the pixel
  assert.equal(at(8.5), 0);
});

test("the foot line bridges short gaps and keeps true ends, so it holds still as the zoom moves", () => {
  const runs = View.settle([[0, 30], [100, 160], [170, 260]], [[300, 310], [390, 400]], 50);
  assert.deepEqual(runs.first, [[0, 30], [100, 260]]);   // the 10 s gap bridged, the 70 s one kept
  assert.deepEqual(runs.second, [[300, 310], [390, 400]]);
  // Zooming out (a wider gap) only ever joins stretches; ends never move.
  const wider = View.settle([[0, 30], [100, 160], [170, 260]], [], 80);
  assert.deepEqual(wider.first, [[0, 260]]);
  // A gap with other work in it stays open, however narrow: bridging it would hide that work.
  const mixed = View.settle([[0, 30], [40, 60]], [[32, 38]], 50);
  assert.deepEqual(mixed.first, [[0, 30], [40, 60]]);
  assert.deepEqual(mixed.second, [[32, 38]]);
});

function data(segs) {
  return {
    span: at(COLUMNS), view: 600, left: 20, right: 20, room: 170, labels: "end",
    gap: 30, radius: 12, soften: 6, minDrawnPx: 2,
    days: [[0, "Mon 14 Sep", 0]], axis: { work: [8, 16], dots: [8, 12, 16], standup: [9, 30] },
    segs: segs.map(([s, e], i) => ({ s: at(s), e: at(e), c: ["#000", "#111", "#222"], name: "s" + i, f: [], w: [] })),
    foot: [], foot2: [],
  };
}

test("a line too short to see is drawn at least a couple of pixels wide", () => {
  const d = data([[0, 400], [100, 100.01]]);
  const g = View.layout(d, 1440 * 60);         // a minute a pixel... at a day a screen scale
  const drawnPx = (g.segs[1].end - g.segs[1].start) / g.spp;
  assert.ok(drawnPx >= d.minDrawnPx - 1e-9);
});

test("only lines still open at the right edge are named, at every zoom", () => {
  const d = data([[0, 400], [10, 60], [70, 140], [150, 170], [200, 380]]);
  const labelled = dayPx => {
    const svg = { innerHTML: "", setAttribute() {} };
    const g = View.layout(d, dayPx, 600);
    View.draw(svg, d, g, 0, g.width);
    return [...svg.innerHTML.matchAll(/class="lab" data-index="(\d+)"/g)].map(m => +m[1]);
  };
  for (const dayPx of [500, 4000]) assert.deepEqual(labelled(dayPx), [0], `at ${dayPx} px a day`);
});

test("the plot is the same height at every zoom, and tall enough for the cloth at any", () => {
  // Many lines opening together pile the bends; the height must not follow the zoom.
  const d = data(Array.from({length: 12}, (_, i) => [i * 3, 60 + i * 25]).concat([[0, 400], [5, 380]]));
  const heights = new Set();
  for (const dayPx of [30, 48, 200, 900, 4000]) {
    const g = View.layout(d, dayPx, 600);
    heights.add(g.plotH);
    for (const layer of g.laid) for (const y of layer.ys) assert.ok(y + 8 <= g.plotH + 0.5, `y ${y} above ${g.plotH} at ${dayPx}`);
  }
  assert.equal(heights.size, 1, [...heights].join(", "));
});

test("moments are marked on their line: pinches, and a second kind as ticked badges", () => {
  const d = data([[0, 400], [50, 300], [100, 200]]);
  d.segs[0].m = [at(150)];
  d.segs[0].b = [at(390)];
  const svg = { innerHTML: "", setAttribute() {} };
  const g = View.layout(d, 2000, 600);
  View.draw(svg, d, g, 0, g.width);
  assert.equal((svg.innerHTML.match(/class="pinch"/g) || []).length, 1);
  assert.equal((svg.innerHTML.match(/class="badge"/g) || []).length, 1);
  assert.match(svg.innerHTML, /class="badge-tick"/);
});

test("drawing gives every visible layer a path", () => {
  const d = data([[0, 400], [50, 300], [100, 200]]);
  const svg = { innerHTML: "", setAttribute() {} };
  const g = View.layout(d, 2000, 600);
  View.draw(svg, d, g, 0, g.width);
  assert.equal((svg.innerHTML.match(/class="line"/g) || []).length, 3);
});

test("a stronger stretch is a piece of its line, cut square across it, not upright", () => {
  const d = data([[0, 400], [50, 300], [100, 200]]);
  d.segs[0].w = [[at(120), at(180)]];
  const svg = { innerHTML: "", setAttribute() {} };
  const g = View.layout(d, 2000, 600);
  View.draw(svg, d, g, 0, g.width);
  const paths = [...svg.innerHTML.matchAll(/<path d="M([^"]+)" stroke="([^"]+)" class="line" data-index="0"/g)];
  assert.equal(paths.length, 2, "the line, and its working stretch over it");
  const [base, piece] = paths.map(m => m[1].split(" L").map(xy => xy.split(",").map(Number)));
  assert.equal(paths[1][2], d.segs[0].c[1]);
  // Every point of the piece lies on the line beneath it.
  const yAt = x => { for (let i = 1; i < base.length; i++) if (base[i][0] >= x) {
    const [x0, y0] = base[i - 1], [x1, y1] = base[i]; return y0 + (y1 - y0) * (x - x0) / ((x1 - x0) || 1); } };
  for (const [x, y] of piece) assert.ok(Math.abs(yAt(x) - y) < 0.6, `(${x}, ${y}) off the line`);
});

test("thinning to fit leaves out the shortest where too many are open, and nothing else", () => {
  const h = 3600;
  const segs = [
    {s: 0, e: 20 * h},            // long
    {s: 2 * h, e: 12 * h},        // medium
    {s: 3 * h, e: 4 * h},         // short, in the crowd
    {s: 5 * h, e: 5.5 * h},       // shorter, in the crowd
    {s: 15 * h, e: 15.2 * h},     // shortest of all, but at a quiet time
  ];
  assert.deepEqual(View.thin(segs, 3), [0, 1, 2, 3, 4]);   // room for all
  const kept = View.thin(segs, 2);
  assert.deepEqual(kept, [0, 1, 4]);
  assert.ok(View.mostOpen(kept.map(i => segs[i])) <= 2);
  assert.deepEqual(View.thin(segs, 1), [0]);    // even the quiet one overlaps the long one
});

test("the layers a height has room for match the layout's height", () => {
  const data = {span: 86400, view: 800, left: 20, right: 20, room: 0, labels: null, gap: 30, radius: 12,
                soften: 6, minDrawnPx: 2, days: [], axis: null, foot: [],
                foot2: [], segs: [0, 1, 2, 3].map(i => ({s: i * 100, e: 80000, c: ["#000", "#000", "#000"],
                                                          name: "", f: [], w: []}))};
  const g = View.layout(data, 250, 800);
  assert.equal(View.layersIn(data, g.height), 4);
  assert.equal(View.layersIn(data, g.height - 1), 3);
});
