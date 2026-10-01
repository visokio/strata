#!/usr/bin/env python3
"""A git repo's branches as a Strata table: each branch a line, from its first
commit to the merge that closed it.

    git clone --bare --filter=tree:0 https://github.com/git/git git.git
    git -C git.git fetch --filter=tree:0 origin +refs/heads/next:refs/heads/next
    python3 tools/git-branches.py git.git --cooking next --from 2026-09-01 --to 2026-09-15 > git.csv

Only git, so no API, no key and no rate limit: a branch is what a merge commit's
second parent brought in, which suits repos that merge with merge commits (git/git,
rails/rails), not ones that squash. A branch nobody merged leaves no trace.

Rows, as the Strata view reads them (customview/README.md, "Data"):
- the branch, open: emphasis 0, from its first commit (author time) to its merge
  into the main line - or to the window's end, if that came later or not yet;
- each commit: emphasis 2, the quarter hour before its author time - the work; or,
  with --commits moment, a row with no length at that time (Moment "commit"), which
  the view marks with a pinch on the line; with --merges moment, the same at its merge (Moment
  "merge"), a badge with a tick;
- with --cooking BRANCH (git's "next"): emphasis 1 from the branch's first merge
  into it - cooking, in use and under test, waiting to graduate;
- without it, each commit re-applied later (as a rebase leaves it): emphasis 1,
  the quarter hour before its commit time;
- every merge by the maintainers, into the main line or the cooking branch, a
  foot row "merging", the five minutes before it.

A branch named "xx/topic" (git's convention: the author's initials) is coloured by
its xx; any other, by the top-level folder most of its changes are in (Rails'
components). Merges of tags and of long-lived branches are maintainers' work, in the
foot, not lines. Times UTC,
clipped to the window.
"""
import argparse
import collections
import csv
import datetime as dt
import re
import subprocess
import sys

WORK = dt.timedelta(minutes=15)
MERGING = dt.timedelta(minutes=5)
# Long-lived branches merged into each other: integration, not work.
INTEGRATION = {"main", "master", "maint", "next", "seen", "pu", "develop", "release"}
TESTS_RE = re.compile(r"(^|/)(tests?|specs?|__tests__|testing)(/|$)")
MERGE_RE = re.compile(r"Merge (?:branch|pull request #(\d+) from) '?([^' ]+)'?")


def git(repo, *args):
    return subprocess.run(["git", "-C", repo] + list(args), capture_output=True, text=True, check=True).stdout


def when(text):
    return dt.datetime.fromisoformat(text).astimezone(dt.timezone.utc)


def stamp(t):
    return t.strftime("%Y-%m-%d %H:%M:%S")


def merges(repo, branch, since):
    """(sha, main parent, merged-in parent, when, subject, body) along branch's first parents."""
    out = []
    log = git(repo, "log", "--first-parent", "--merges", branch, "--since=" + since.isoformat(),
              "--format=%H%x1f%P%x1f%cI%x1f%s%x1f%b%x1e")
    for record in log.split("\x1e"):
        if record.strip():
            sha, parents, at, subject, body = (record.strip("\n").split("\x1f") + [""] * 5)[:5]
            main_parent, *others = parents.split()
            out.append((sha, main_parent, others[0] if others else None, when(at), subject, body))
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("repo", help="a clone (a bare, tree-less one is enough)")
    parser.add_argument("--from", dest="start", required=True, help="first day, YYYY-MM-DD (UTC)")
    parser.add_argument("--to", dest="end", required=True, help="the day after the last, YYYY-MM-DD (UTC)")
    parser.add_argument("--branch", default="HEAD", help="the main line (default HEAD)")
    parser.add_argument("--cooking", help="a branch that topics are merged into first, as git's next")
    parser.add_argument("--lookback", type=int, default=90, help="days before the window to look for branches")
    parser.add_argument("--open", type=int, default=0, choices=(0, 1, 2),
                        help="the emphasis of a branch's open time: 0 faint (default), 1 medium")
    parser.add_argument("--commits", default="stretch", choices=("stretch", "moment"),
                        help="each commit as the quarter hour before it, strong (default), or as a moment - "
                             "a row with no length, which the view marks with a pinch on the line")
    parser.add_argument("--merges", default="none", choices=("none", "moment"),
                        help="mark each merge with a moment of its own kind (\"merge\"), which the view draws "
                             "as a badge with a tick")
    parser.add_argument("--depth", type=int, default=1,
                        help="colour by the folder this many levels down (astropy/units: 2) - default the top level")
    args = parser.parse_args()
    lo = dt.datetime.fromisoformat(args.start).replace(tzinfo=dt.timezone.utc)
    hi = dt.datetime.fromisoformat(args.end).replace(tzinfo=dt.timezone.utc)
    since = lo - dt.timedelta(days=args.lookback)

    branches = {}      # key -> {label, colour, commits: {(authored, committed)}, cooking, closed, tips}

    def branch(subject, body, main_parent, tip, sha):
        found = MERGE_RE.search(subject)
        number, name = (found.group(1), found.group(2)) if found else (None, None)
        if name and name.split("/")[-1] in INTEGRATION:
            return None
        key = "#" + number if number else name or sha[:8]
        entry = branches.setdefault(key, {"commits": set(), "cooking": None, "closed": None, "name": name,
                                          "title": "", "ranges": []})
        title = next((line.strip() for line in body.splitlines() if line.strip()), "")
        entry["title"] = entry["title"] or title
        entry["ranges"].append((main_parent, tip))
        for line in git(args.repo, "log", "%s..%s" % (main_parent, tip), "--format=%aI%x1f%cI").splitlines():
            authored, committed = line.split("\x1f")
            entry["commits"].add((when(authored), when(committed)))
        return entry

    out = csv.writer(sys.stdout)
    out.writerow(["Layer", "Start", "End", "Label", "Colour", "Emphasis", "Foot", "Moment"])

    def row(layer, a, b, label, colour, emphasis, foot="", moment=""):
        a, b = max(a, lo), min(b, hi)
        if b > a or (b == a and lo <= a < hi and layer):
            out.writerow([layer, stamp(a), stamp(b), label, colour, emphasis, foot, moment])

    for sha, main_parent, tip, at, subject, body in merges(args.repo, args.branch, since):
        row("", at - MERGING, at, "", "", "", "merging")
        entry = branch(subject, body, main_parent, tip, sha) if tip and MERGE_RE.search(subject) else None
        if entry:
            entry["closed"] = min(entry["closed"] or at, at)
    if args.cooking:
        for sha, main_parent, tip, at, subject, body in merges(args.repo, args.cooking, since):
            row("", at - MERGING, at, "", "", "", "merging")
            entry = branch(subject, body, main_parent, tip, sha) if tip and MERGE_RE.search(subject) else None
            if entry:
                entry["cooking"] = min(entry["cooking"] or at, at)

    for key, entry in branches.items():
        if not entry["commits"]:
            continue
        opened = min(a for a, _ in entry["commits"])
        closed = entry["closed"] or hi
        if opened >= hi or closed <= lo:
            continue
        initials = (entry["name"] or "").split("/")[0] if "/" in (entry["name"] or "") else ""
        if re.fullmatch(r"[a-z]{2,3}", initials):
            colour = initials
        else:
            folders = collections.Counter()
            for main_parent, tip in entry["ranges"][:1]:
                paths = git(args.repo, "diff", "--name-only", "%s...%s" % (main_parent, tip)).split()
                # What the branch changes, not the tests that come with it -
                # unless tests are all it touches.
                code = [p for p in paths if not TESTS_RE.search(p)] or paths
                folders.update("/".join(p.split("/")[:min(args.depth, p.count("/"))]) for p in code if "/" in p)
            colour = folders.most_common(1)[0][0] if folders else "other"
        title = entry["title"]
        label = (entry["name"] or key) if not key.startswith("#") else "%s %s" % (key, title[:48])
        row(key, opened, closed, label, colour, args.open)
        if args.merges == "moment" and entry["closed"] and lo <= closed < hi:
            row(key, closed, closed, label, colour, 2, moment="merge")
        if entry["cooking"]:
            row(key, entry["cooking"], closed, label, colour, max(1, args.open))
        for authored, committed in sorted(entry["commits"]):
            if args.commits == "moment":
                row(key, authored, authored, label, colour, 2, moment="commit")
                continue
            row(key, max(authored - WORK, opened), authored, label, colour, 2)
            if not args.cooking and committed - authored > WORK:
                row(key, committed - WORK, committed, label, colour, 1)


if __name__ == "__main__":
    main()
