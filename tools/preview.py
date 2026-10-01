#!/usr/bin/env python3
"""The Strata view on a CSV, as one self-contained page - no Omniscope needed.

    python3 tools/preview.py rows.csv out.html [--title TEXT] [--workday off] [--standup ""] [--intro glide]

The CSV has the view's fields by name (Layer, Start, End, Label, Colour,
Emphasis, Foot, Moment, At; README, "Data"). The page runs the custom view's
index.html and scripts unchanged, against a stand-in for Omniscope's view API
holding the rows - as tests/customview.test.mjs does - so what it shows is what
the view shows. For looking at a dataset before building a report, or sending one.
"""
import argparse
import csv
import html
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIEW = os.path.join(ROOT, "customview")
SRC = os.path.join(ROOT, "src")
API = '<script src="/_global_/customview/v1/omniscope.js"></script>'

STAND_IN = """<script>
(function () {
  var rows = %(rows)s, handlers = {};
  var context = {options: {items: %(options)s}, dataConfig: {filter: null},
                 manifest: {dataLimit: 1000000}, viewSelection: null};
  window.omniscope = {view: {
    on: function (evs, fn) { [].concat(evs).forEach(function (e) { (handlers[e] = handlers[e] || []).push(fn); }); },
    context: function () { return context; },
    busy: function () {}, endpoint: function () { return ""; },
    error: function (m) { console.error(m); },
    updated: function () {}, whitespaceClick: function () {},
    queryBuilder: function () {
      var q, done = {};
      var request = {
        table: function (query) { q = query; return request; },
        on: function (ev, fn) { done[ev] = fn; return request; },
        execute: function () {
          var records = rows.map(function (r) { return q.fields.map(function (f) { return r[f]; }); });
          setTimeout(function () { done.load({data: {records: records, schema: {fields: q.fields}}}); }, 0);
        }
      };
      return request;
    }
  }};
  window.addEventListener("load", function () {
    setTimeout(function () { (handlers.load || []).forEach(function (fn) { fn({data: context}); }); }, 0);
  });
  window.addEventListener("resize", function () {
    (handlers.resize || []).forEach(function (fn) { fn({data: context}); });
  });
})();
</script>"""


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("csv")
    parser.add_argument("out")
    parser.add_argument("--title", default="Strata")
    parser.add_argument("--order", default="Longest-lived on top")
    parser.add_argument("--labels", default="At the end")
    parser.add_argument("--intro", default="Glide in")
    parser.add_argument("--workday", default="on", choices=("on", "off"))
    parser.add_argument("--standup", default="")
    parser.add_argument("--paper", action="store_true",
                        help="on cream paper (#f6efe1) rather than white, for a page of that colour")
    parser.add_argument("--all", action="store_true",
                        help="every line, the page scrolling, rather than fitting the window's height as in an "
                             "Omniscope pane (which leaves the shortest out where too many are open at once)")
    args = parser.parse_args()

    with open(args.csv, newline="") as handle:
        rows = list(csv.DictReader(handle))
    fields = rows[0].keys() if rows else []
    for row in rows:
        if row.get("Emphasis", "") != "":
            row["Emphasis"] = float(row["Emphasis"])
    options = {key: name for key, name in (("layer", "Layer"), ("start", "Start"), ("end", "End"),
                                           ("label", "Label"), ("colour", "Colour"),
                                           ("emphasis", "Emphasis"), ("foot", "Foot"), ("moment", "Moment"),
                                           ("momentAt", "At"))
               if name in fields}
    options.update(order=args.order, labels=args.labels, intro=args.intro,
                   workday=args.workday == "on", standup=args.standup)

    with open(os.path.join(VIEW, "index.html")) as handle:
        page = handle.read()
    if args.all:
        page = page.replace("fitHeight: true", "fitHeight: false")
        page = page.replace("html, body { margin: 0; height: 100%;", "html, body { margin: 0; min-height: 100%;")
        page = page.replace("sans-serif; overflow: hidden; }", "sans-serif; overflow: auto; }", 1)
    if args.paper:
        # Every white the page paints - label halos, the badges' rims, the
        # tints worked out against the surface - becomes the paper's cream.
        page = page.replace("#ffffff", "#f6efe1")
    page = page.replace(API, STAND_IN % {"rows": json.dumps(rows, separators=(",", ":")),
                                         "options": json.dumps(options)})
    for name in ("strata-cloth.js", "strata-view.js", "strata-ui.js"):
        with open(os.path.join(SRC, name)) as handle:
            page = page.replace('<script src="%s"></script>' % name, "<script>%s</script>" % handle.read())
    page = page.replace("<title>Strata</title>", "<title>%s</title>" % html.escape(args.title), 1)
    with open(args.out, "w") as handle:
        handle.write(page)
    print("%s (%d rows)" % (args.out, len(rows)))


if __name__ == "__main__":
    main()
