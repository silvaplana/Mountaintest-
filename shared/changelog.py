#!/usr/bin/env python3
"""Historique des versions affiché dans l'onglet « Versions » des deux applis.

Construit à partir des commits (le plus récent en premier), sans les commits techniques
de la CI. Usage : python3 shared/changelog.py <build> <fichier.json>
"""
import json
import os
import subprocess
import sys

IGNORE = ("CI :", "Clé de signature", "Merge ")

def main(build: str, out: str) -> None:
    sep, end = "\x1f", "\x1e"
    log = subprocess.run(
        ["git", "log", f"--format=%H{sep}%ad{sep}%s{sep}%b{end}", "--date=iso-strict-local"],
        capture_output=True, text=True, check=True, env={**os.environ, "TZ": "Europe/Paris"},
    ).stdout
    entries = []
    for raw in log.split(end):
        raw = raw.strip("\n")
        if not raw:
            continue
        sha, date, subject, body = (raw.split(sep) + ["", "", "", ""])[:4]
        if subject.startswith(IGNORE):
            continue
        details = [l.strip()[2:].strip() for l in body.splitlines() if l.strip().startswith("- ")]
        # Les lignes « - » peuvent continuer sur la ligne suivante (indentée) : on les recolle.
        lines, cur = [], None
        for l in body.splitlines():
            s = l.strip()
            if s.startswith("- "):
                cur = s[2:].strip(); lines.append(cur)
            elif s and cur is not None and l.startswith("  ") and not s.startswith(("Co-Authored-By", "Claude-Session")):
                lines[-1] = lines[-1] + " " + s
            else:
                cur = None
        entries.append({"date": date[:16].replace("T", " "), "title": subject, "details": lines or details, "commit": sha[:7]})
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"build": int(build), "entries": entries}, f, ensure_ascii=False, indent=1)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
