#!/usr/bin/env python3
"""Build data/handbook-degrees.json: 2537 Bachelor of Arts/Bachelor of Laws for 2027.

The WSLSA workbook has no sheet for this degree, so its pathway is put together here from two sources:
the 2027 Handbook page for 2537 (its structure: 230 CP of core subjects, an 80 CP Arts major, a 40 CP Arts
minor and 50 CP of LLB Alternates), and the WSLSA pathway for 2538 Bachelor of Social Science/Bachelor of
Laws, whose Law subjects sit in the same sessions for every double degree. The four Arts core subjects take
the sessions the workbook publishes for them (in the 2843 catalogue). The Handbook page lists 29 majors and
22 minors without their subjects, so the major and minor are slots a student fills with their own subjects.

    python -P scripts/make_arts_laws.py        (needs segno for the Handbook QR code: pip install segno)
"""
import io
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "wslsa-2027.json"
OUT = ROOT / "data" / "handbook-degrees.json"
CODE = "2537"
KEY = CODE + "|BASE"
TITLE = "Bachelor of Arts/Bachelor of Laws"
HANDBOOK = "https://studenthandbook.westernsydney.edu.au/course/2027/2537"
DASH = "–"
# the Arts core subjects, each in a Year 1 session it runs in at Parramatta South
ARTS_CORE = {(1, "Autumn", 3): "LANG 1029", (1, "Autumn", 4): "HUMN 1053", (1, "Spring", 2): "HUMN 1052", (1, "Spring", 3): "LANG 1030"}
MAJORS = 29
MINORS = 22


def qr_svg(url):
    import segno
    qr = segno.make(url, error="m")
    buf = io.BytesIO()
    qr.save(buf, kind="svg", border=2, scale=1, xmldecl=False, svgns=True, nl=False,
            omitsize=True, dark="#1b2433", svgclass="qr", lineclass=None)
    return buf.getvalue().decode("utf-8")


def info(text):
    codes = [c for c in (text or "").split() if c.isupper() and c != "TBC"]
    return {"codes": codes, "tbc": text == "TBC", "y2026": False, "none": not codes and text != "TBC"}


def main():
    d = json.loads(DATA.read_text(encoding="utf-8"))
    by_code = {g["code"]: g for g in d["degrees"]}
    social = by_code["2538"]
    arts = {c["code"]: c for c in by_code["2843"]["catalogue"]}
    rows = []
    majors = minors = 0
    for r in d["pathways"]["2538|0002"]:
        at = (r["year"], r["session"], r["slot"])
        row = {"rowKey": "%s|BASE|%d|%s|%d" % (CODE, r["year"], r["session"], r["slot"]), "degree": CODE, "major": "BASE",
               "year": r["year"], "session": r["session"], "slot": r["slot"], "cp": 10}
        if r["type"] in ("Law", "LLB alternate"):
            row.update({k: r[k] for k in ("code", "title", "type", "offered", "notes", "offeredInfo", "kind")})
            if r.get("pool"):
                row["pool"] = r["pool"]
        elif at in ARTS_CORE:
            c = arts[ARTS_CORE[at]]
            offered = c[r["session"].lower()]
            row.update({"code": c["code"], "title": c["title"], "type": "Non-law", "offered": offered, "notes": None,
                        "offeredInfo": info(offered), "kind": "fixed"})
        elif r["type"] == "Non-law":
            minors += 1
            row.update({"code": "Choose", "title": "Arts Minor subject", "type": "Minor", "offered": None,
                        "notes": "A subject of your Arts minor (see its page in the Handbook)",
                        "offeredInfo": info(None), "kind": "elective"})
        else:
            majors += 1
            row.update({"code": "Choose", "title": "Arts Major subject", "type": "Major", "offered": None,
                        "notes": "A subject of your Arts major (see its page in the Handbook)",
                        "offeredInfo": info(None), "kind": "elective"})
        rows.append(row)
    assert majors == 8 and minors == 4, (majors, minors)
    assert sum(r["cp"] for r in rows) == 400
    assert len([r for r in rows if r["type"] == "Law"]) == 19 and len([r for r in rows if r["type"] == "LLB alternate"]) == 5

    catalogue = []
    for code in ("HUMN 1052", "LANG 1029", "HUMN 1053", "LANG 1030"):
        catalogue.append(dict(arts[code], component="Core"))
    for c in social["catalogue"]:
        if c["component"] == "Core - Laws Component":
            catalogue.append(dict(c, component="Core"))
        elif c["component"] == "LLB Alternate Subjects":
            catalogue.append(dict(c))
    label = "%s %s %s" % (CODE, DASH, TITLE)
    degree = {
        "code": CODE, "title": TITLE, "label": label, "cp": 400, "ftYears": 5, "ptYears": 10,
        "intake": "See the Handbook", "intakeList": [], "campuses": "Parramatta South, Campbelltown",
        "campusList": ["Parramatta South", "Campbelltown"], "students": "Domestic, International",
        "majorChoices": "%d majors and %d minors" % (MAJORS, MINORS), "pathwayGroups": 1,
        "assumedKnowledge": "Assumed Knowledge: Any two units of HSC English; Assumed Knowledge: Recommended Studies: HSC English Standard or equivalent",
        "accreditation": [{"name": "Legal Profession Admission Board (LPAB)", "abbr": "LPAB", "status": "Essential to work in profession"}],
        "exitAwards": [{"code": "1706", "name": "Bachelor of Arts", "exitOnly": False}, {"code": "2848", "name": "Bachelor of Laws", "exitOnly": False},
                       {"code": "2827", "name": "Diploma in Laws", "exitOnly": True}],
        "tbcSubjects": social["tbcSubjects"], "cricos": "041113G", "handbook": HANDBOOK, "fixedStructure": True,
        "sheet": "2537 Arts-Laws",
        "sheetIntro": "2027 Student Handbook data. This degree has no sheet in the WSLSA 2027 Degree Guides workbook, so its pathway is put together from the Handbook's structure for 2537 and the WSLSA Law sequence used for the other double degrees. The Handbook lists your Arts major and minor without a session for each subject, so their slots are yours to fill. It is not an official WSU sequence.",
        "structure": [{"component": "Core", "cp": 230}, {"component": "Arts Major", "cp": 80}, {"component": "Arts Minor", "cp": 40},
                      {"component": "LLB Alternate Subjects", "cp": 50}],
        "structureTotal": 400, "catalogueNote": social["catalogueNote"], "advisorNotes": [], "options": [KEY], "qrSvg": qr_svg(HANDBOOK),
        "catalogue": catalogue,
        # shown in place of "No major or minor": the choice is the student's, made in the slots
        "majorNote": "Choose your Arts major (80 CP) and minor (40 CP) in the Handbook, then put their subjects in the Major and Minor slots",
    }
    option = {"degree": CODE, "degreeLabel": label, "majorLabel": "Arts major and minor of your choice", "majorCode": "BASE", "majorName": None,
              "majorKind": None, "pathwayKey": KEY, "pathwayGroup": "Single recommended pathway for this degree", "groupLetter": None, "groupUsedFor": []}
    out = {
        "about": "Degrees that are not in the WSLSA workbook, built by scripts/make_arts_laws.py from the 2027 Handbook and the workbook's own Law sequence. build_app.py adds them to the workbook's degrees.",
        "degrees": [degree], "options": [option], "pathways": {KEY: rows},
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("wrote", OUT.name, len(rows), "rows,", len(catalogue), "catalogue subjects")


if __name__ == "__main__":
    main()
