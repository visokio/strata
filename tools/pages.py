#!/usr/bin/env python3
"""Build the standalone demo pages into dist/pages/, one per example.

    python3 tools/pages.py        (npm run pages)

Each page is self-contained - the view, its scripts and the data in one HTML
file - so it opens from disk, a web server or an email attachment.
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "dist", "pages")


def run(*args):
    subprocess.run([sys.executable] + list(args), check=True, cwd=ROOT)


def main():
    os.makedirs(OUT, exist_ok=True)
    rows = os.path.join(ROOT, "dist", "claude-code-sessions-2026-09.csv")
    run("tools/compose.py", "examples/claude-code-sessions-2026-09", rows)
    run("tools/preview.py", rows, os.path.join(OUT, "claude-code-sessions.html"),
        "--title", "Two weeks of Claude Code sessions", "--standup", "09:30")
    run("tools/preview.py", "examples/homebrew-prs-2026-08.csv", os.path.join(OUT, "homebrew.html"),
        "--title", "Homebrew's pull requests", "--workday", "off")
    run("tools/preview.py", "examples/git-topics-2026-09.csv", os.path.join(OUT, "git-topics.html"),
        "--title", "Git's topic branches", "--workday", "off")


if __name__ == "__main__":
    main()
