#!/usr/bin/env python3
"""The demo's tidy tables, composed into the rows the Strata view reads.

    python3 tools/compose.py examples/claude-code-sessions-2026-09 out.csv [--no-attention]

The folder holds four tables, as a business would keep them:

  sessions.csv   Session, Workspace, Session Name, Opened, Closed, ...
  stretches.csv  Session, Start, End, State (me / claude / idle)
  attention.csv  Start, End, Where (claude / other)
  commits.csv    Session, At, Commit

This does what an Omniscope report does with them (customview/README.md, "From
business data"): stretches joined to their sessions, with a display name and
State as an emphasis number; commits as moments on their lines; attention
appended as the foot line. Without attention (--no-attention) the view draws
the foot line from the lines themselves. Out comes one CSV in the view's
fields - Layer, Start, End, Label, Colour, Emphasis, Foot, Moment - for
tools/preview.py.
"""
import argparse
import csv
import os

EMPHASIS = {"me": 2, "claude": 1, "idle": 0}
FIELDS = ["Layer", "Start", "End", "Label", "Colour", "Emphasis", "Foot", "Moment"]


def read(folder, name):
    with open(os.path.join(folder, name + ".csv"), newline="") as handle:
        return list(csv.DictReader(handle))


def compose(folder, attention=True):
    sessions = {row["Session"]: row for row in read(folder, "sessions")}

    def named(session):
        row = sessions.get(session, {})
        workspace, name = row.get("Workspace", ""), row.get("Session Name", "")
        return (workspace + (" · " + name if name else "")) or session, workspace or session

    rows = []
    for row in read(folder, "stretches"):
        if row["Session"] not in sessions:
            continue
        label, colour = named(row["Session"])
        rows.append({"Layer": row["Session"], "Start": row["Start"], "End": row["End"], "Label": label,
                     "Colour": colour, "Emphasis": EMPHASIS.get(row["State"], 0), "Foot": "", "Moment": ""})
    for row in read(folder, "commits"):
        if row["Session"] not in sessions:
            continue
        label, colour = named(row["Session"])
        rows.append({"Layer": row["Session"], "Start": row["At"], "End": row["At"], "Label": label,
                     "Colour": colour, "Emphasis": "", "Foot": "", "Moment": "commit"})
    if attention:
        for row in read(folder, "attention"):
            rows.append({"Layer": "", "Start": row["Start"], "End": row["End"], "Label": "", "Colour": "",
                         "Emphasis": "", "Foot": row["Where"], "Moment": ""})
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("folder")
    parser.add_argument("out")
    parser.add_argument("--no-attention", action="store_true",
                        help="leave the attention table out: the view draws the foot line from the lines")
    args = parser.parse_args()
    rows = compose(args.folder, attention=not args.no_attention)
    with open(args.out, "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print("%s (%d rows)" % (args.out, len(rows)))


if __name__ == "__main__":
    main()
