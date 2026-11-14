#!/usr/bin/env python3
"""Read the University's pre-2027 program pages (saved as PDFs from the 2025 Handbook) into data/pre2027.json.

Each PDF has one or more Recommended Sequence tables: a heading such as "Full-time start-year intake", then
years and sessions, each with its subjects (code, title, credit points) and its "Select ..." rows for choices.
The PDFs are not kept in this repository; run this with the folder that holds them:

    python -P scripts/extract_pre2027.py "path/to/2025 Degree pdfs"

Needs PyMuPDF (pip install pymupdf).
"""
import json
import re
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "pre2027.json"
CODE = re.compile(r"^([A-Z]{4}) ?(\d{4})$")
SESSION = re.compile(r"^(Autumn|Spring|Summer|1H|2H|Quarter \d|Term \d)\b.*session$|^(Autumn|Spring|Summer) session$", re.I)
HEADING = re.compile(r"^(Full|Part)[- ]time .*intake\s*$|^.*\b(start-year|mid-year) intake\s*$", re.I)


def lines_of(pdf):
    out = []
    for page in pymupdf.open(pdf):
        for raw in page.get_text().splitlines():
            line = raw.replace("ﬁ", "fi").replace("ﬂ", "fl").replace(" ", " ").strip()
            out.append(line)
    return out


def parse(pdf):
    lines = lines_of(pdf)
    title = next((l for l in lines if re.search(r"\(\d{4}\)\s*$", l)), pdf.stem)
    m = re.search(r"^(.*?)\s*\((\d{4})\)\s*$", title)
    info = {"file": pdf.name, "title": m.group(1).strip() if m else title, "program": m.group(2) if m else "", "sequences": []}
    seq = None
    year = 0
    session = ""
    last_heading = ""
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        if HEADING.match(line):
            last_heading = line.strip()
        if line == "Course" and i + 1 < n and lines[i + 1] == "Title":
            # the table's heading is printed again at the top of each page it runs on to
            if seq is None:
                seq = {"name": last_heading or "Recommended sequence", "rows": []}
                info["sequences"].append(seq)
                year, session = 0, ""
            i += 2
            continue
        if seq is None:
            i += 1
            continue
        if re.match(r"^Total Credit Points$", line):
            seq["total"] = int(lines[i + 1]) if i + 1 < n and lines[i + 1].isdigit() else 0
            seq = None
            i += 2
            continue
        ym = re.match(r"^Year (\d+)$", line)
        if ym:
            year = int(ym.group(1))
            i += 1
            continue
        sm = re.match(r"^(Autumn|Spring|Summer)\b.*session$", line, re.I)
        if sm:
            session = sm.group(1).capitalize()
            i += 1
            continue
        if line == "Credit Points" and i + 1 < n and lines[i + 1].isdigit():
            seq["rows"].append({"y": year, "s": session, "sum": int(lines[i + 1])})
            i += 2
            continue
        cm = CODE.match(line)
        if cm and year and session:
            code = cm.group(1) + " " + cm.group(2)
            j = i + 1
            words = []
            cp = None
            while j < n and j < i + 6:
                nxt = lines[j]
                if nxt.isdigit() and int(nxt) <= 80:
                    cp = int(nxt)
                    j += 1
                    break
                if nxt == "" or CODE.match(nxt) or nxt == "Credit Points" or nxt.startswith("Select") or re.match(r"^Year \d+$", nxt):
                    break
                words.append(nxt)
                j += 1
            row = {"y": year, "s": session, "code": code, "title": " ".join(words).strip()}
            if cp is None:
                # a subject listed under a "Select one of the following" row is one of its options
                prev = next((r for r in reversed(seq["rows"]) if "sum" not in r), None)
                if prev is not None and "text" in prev and prev["y"] == year and prev["s"] == session:
                    prev.setdefault("options", []).append([code, row["title"]])
                    i = j
                    continue
                row["cp"] = 10
            else:
                row["cp"] = cp
            seq["rows"].append(row)
            i = j
            continue
        if line.startswith("Select") and year and session:
            words = [line]
            j = i + 1
            cp = None
            while j < n and j < i + 5:
                nxt = lines[j]
                if nxt.isdigit() and int(nxt) <= 80:
                    cp = int(nxt)
                    j += 1
                    break
                if nxt == "" or CODE.match(nxt) or nxt == "Credit Points":
                    break
                words.append(nxt)
                j += 1
            seq["rows"].append({"y": year, "s": session, "text": " ".join(words).strip().rstrip(":"), "cp": cp if cp is not None else 10})
            i = j
            continue
        i += 1
    for s in info["sequences"]:
        # each session's rows should add up to the total the page prints under them
        rows, check, run = [], [], 0
        for r in s["rows"]:
            if "sum" in r:
                check.append(run == r["sum"])
                run = 0
            else:
                run += r["cp"]
                rows.append(r)
        s["rows"] = rows
        s["checked"] = all(check) if check else False
        s["cp"] = sum(r["cp"] for r in rows)
    return info


def main():
    src = Path(sys.argv[1])
    programs = [parse(p) for p in sorted(src.glob("*.pdf"))]
    out = {
        "about": "The University's recommended sequences for students who started before 2027, read from its 2025 Handbook program pages by scripts/extract_pre2027.py. Check against the Handbook archive before relying on a row.",
        "source": "https://hbook.westernsydney.edu.au/archives/2024-2025/",
        "programs": programs,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for p in programs:
        print(p["program"], p["title"][:60], "|", "; ".join("%s: %d rows, %d CP%s" % (s["name"][:28], len(s["rows"]), s["cp"], "" if s["checked"] and s["cp"] == s.get("total", 0) else " (CHECK)") for s in p["sequences"]))


if __name__ == "__main__":
    main()
