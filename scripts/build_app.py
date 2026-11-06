#!/usr/bin/env python3
"""Bundle src/ + data/wslsa-2027.json into one self-contained HTML file.

Usage:
    python3 scripts/build_app.py            # writes dist/wslsa-pathway-explorer.html

The full JSON data store keeps every workbook field. The app payload drops only fields that are
duplicated elsewhere in the store (degree-sheet copies of Pathway Data, key facts repeated from
Overview, per-row degree/major keys) and packs pathway and catalogue rows as arrays to keep the
single file small enough to email or host anywhere.
"""
import base64
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "wslsa-2027.json"
PREREQS = ROOT / "data" / "prerequisites.json"
SRC = ROOT / "src"
OUT = ROOT / "dist" / "wslsa-pathway-explorer.html"

DEGREE_FIELDS = [
    "code", "title", "label", "cp", "ftYears", "ptYears", "intake", "intakeList", "campuses", "campusList",
    "students", "majorChoices", "pathwayGroups", "assumedKnowledge", "accreditation", "exitAwards",
    "tbcSubjects", "cricos", "handbook", "fixedStructure", "sheet", "sheetIntro", "structure",
    "structureTotal", "catalogueNote", "advisorNotes", "options", "qrSvg",
]
OPTION_FIELDS = ["degree", "degreeLabel", "majorLabel", "majorCode", "majorName", "majorKind", "pathwayKey",
                 "pathwayGroup", "groupLetter", "groupUsedFor"]


def payload(d):
    degrees = []
    for deg in d["degrees"]:
        out = {k: deg[k] for k in DEGREE_FIELDS}
        out["accreditation"] = [{k: a[k] for k in ("name", "abbr", "status")} for a in deg["accreditation"]]
        out["exitAwards"] = [{k: e[k] for k in ("code", "name", "exitOnly")} for e in deg["exitAwards"]]
        out["catalogue"] = [[c["component"], c["level"], c["code"], c["title"], c["autumn"], c["spring"], c["cp"],
                             c["source"]] for c in deg["catalogue"]]
        degrees.append(out)
    pathways = {}
    for key, slots in d["pathways"].items():
        pathways[key] = [[s["year"], s["session"][0], s["slot"], s["code"], s["title"], s["type"], s["offered"],
                          s["cp"], s["notes"], s["kind"], s.get("pool"),
                          [[o["code"], o["title"], o["tbcFlag"]] for o in s["options"]] if s.get("options") else None]
                         for s in slots]
    meta = {k: d["meta"][k] for k in ("title", "explorerIntro", "overviewNote", "legend", "campuses",
                                      "sourceWorkbook", "extractedOn", "counts")}
    meta["subjectList"] = d["meta"].get("subjectList")
    return {
        "meta": meta,
        "degrees": degrees,
        "options": [{k: o[k] for k in OPTION_FIELDS} for o in d["options"]],
        "pathways": pathways,
        "extra": [[x["code"], x["title"]] for x in d.get("additionalSubjects", [])],
        "prereqs": {k: v for k, v in json.loads(PREREQS.read_text(encoding="utf-8")).items() if k != "about"},
    }


def data_uri(name):
    """Logo assets (made by make_logo_assets.py) are inlined so the page stays one self-contained file."""
    return "data:image/png;base64," + base64.b64encode((SRC / "assets" / name).read_bytes()).decode("ascii")


def main():
    d = json.loads(DATA.read_text(encoding="utf-8"))
    data_js = json.dumps(payload(d), ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    html = (SRC / "index.html").read_text(encoding="utf-8")
    parts = {
        "/*@@STYLES@@*/": (SRC / "styles.css").read_text(encoding="utf-8"),
        "/*@@PRINT_STYLES@@*/": (SRC / "print.css").read_text(encoding="utf-8"),
        "/*@@APP@@*/": (SRC / "app.js").read_text(encoding="utf-8"),
        "@@DATA@@": data_js,
        "@@CREST@@": data_uri("wslsa-crest.png"),
        "@@FAVICON@@": data_uri("favicon.png"),
        "@@TOUCH_ICON@@": data_uri("apple-touch-icon.png"),
    }
    for marker, content in parts.items():
        if html.count(marker) != 1:
            sys.exit(f"Template marker {marker} must appear exactly once in src/index.html")
        html = html.replace(marker, content)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB, data payload {len(data_js) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
