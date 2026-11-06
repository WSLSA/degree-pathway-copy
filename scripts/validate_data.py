#!/usr/bin/env python3
"""Integrity checks for data/wslsa-2027.json (run after extract_workbook.py).

The workbook stores each pathway twice: once flat in `Pathway Data` and once on the degree sheet
(a template with 'Major slot' placeholders plus a 'Your major, session by session' table). This
script rebuilds every pathway from the degree sheet and checks it against Pathway Data, then
checks credit points, advisor notes, choice pools and catalogue coverage. Exit code 1 on failure.
"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "wslsa-2027.json"
EXPECTED_DEGREES = ["2848", "2785", "2843", "2788", "2752", "2769", "2767", "2766", "2768", "2800",
                    "2758", "2743", "2538"]

errors, warnings = [], []


def err(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


def sig(s):
    return (s["code"], s["title"], s["type"], s["offered"], s["cp"], s["notes"])


def session_value(entry, session):
    return entry["autumn"] if session == "Autumn" else entry["spring"]


def main():
    d = json.loads(DATA.read_text(encoding="utf-8"))
    degrees = {x["code"]: x for x in d["degrees"]}
    options = {o["pathwayKey"]: o for o in d["options"]}
    pathways = d["pathways"]

    # ---- counts
    if list(degrees) != EXPECTED_DEGREES:
        err(f"degree list/order mismatch: {list(degrees)}")
    if d["meta"]["counts"]["pathwayRows"] != 1915:
        err(f"expected 1915 Pathway Data rows, got {d['meta']['counts']['pathwayRows']}")
    if set(options) != set(pathways):
        err(f"options vs pathways mismatch: {set(options) ^ set(pathways)}")
    if sorted(d["degreeDropdown"]) != sorted(x["label"] for x in d["degrees"]):
        err("Lists 'Degree dropdown' does not match Overview degrees")

    for code, deg in degrees.items():
        # ---- overview vs degree sheet key facts
        kf = deg["keyFacts"]
        for label, key in [("Credit points", "cp"), ("Full-time (years)", "ftYears"), ("Part-time (years)", "ptYears"),
                           ("Intake", "intake"), ("Campuses", "campuses"), ("Handbook", "handbook"),
                           ("External accreditation", "accreditationRaw"), ("Exit awards", "exitAwardsRaw")]:
            if kf.get(label) != deg[key]:
                err(f"{code}: Overview {key}={deg[key]!r} but sheet {label}={kf.get(label)!r}")
        if sum(c["cp"] for c in deg["structure"]) != deg["structureTotal"] or deg["structureTotal"] != deg["cp"]:
            err(f"{code}: program structure components do not add to {deg['cp']}")
        n_opts = len(deg["options"])
        groups = {options[k]["groupLetter"] for k in deg["options"]}
        if len(groups) != deg["pathwayGroups"]:
            err(f"{code}: Overview says {deg['pathwayGroups']} pathway groups, Lists has {groups}")
        if deg["fixedStructure"] != (deg["options"] == [f"{code}|BASE"]):
            err(f"{code}: fixed-structure flag inconsistent with Lists ({n_opts} options)")

        # ---- advisor notes: Lists vs degree sheet
        if [n["text"] for n in deg["advisorNotes"]] != deg["sheetAdvisorNotes"]:
            err(f"{code}: advisor notes on Lists and on the degree sheet differ")
        names = {options[k]["majorName"] for k in deg["options"]}
        for n in deg["advisorNotes"]:
            if n["major"] and n["major"] not in names:
                err(f"{code}: advisor note names unknown major {n['major']!r}")

        catalogue = defaultdict(list)
        for c in deg["catalogue"]:
            catalogue[c["code"]].append(c)
        components = defaultdict(list)
        for c in deg["catalogue"]:
            components[c["component"]].append(c)

        # ---- each pathway of this degree
        for key in deg["options"]:
            opt = options[key]
            slots = pathways[key]
            total = sum(s["cp"] for s in slots)
            if total != deg["cp"]:
                err(f"{key}: pathway totals {total} CP, degree requires {deg['cp']}")
            years = max(s["year"] for s in slots)
            if years != -(-deg["ftYears"] // 1):
                err(f"{key}: pathway runs {years} years, Overview full-time duration is {deg['ftYears']}")

            # rebuild from the degree sheet
            label = "Recommended pathway" + (f" {opt['groupLetter']}" if opt["groupLetter"] else "")
            sheet_pw = [p for p in deg["sheetPathways"] if p["label"] == label]
            if len(sheet_pw) != 1:
                err(f"{key}: expected one sheet pathway labelled {label!r}")
                continue
            sched = [m for m in deg["majorSchedule"] if m["majorCode"] == opt["majorCode"]]
            fill = defaultdict(list)
            for m in sched:
                fill[(m["year"], m["session"])].append(m)
            rebuilt = defaultdict(list)
            for s in sheet_pw[0]["slots"]:
                if s["type"] == "Major slot":
                    q = fill[(s["year"], s["session"])]
                    if not q:
                        err(f"{key}: no major subject to fill Y{s['year']} {s['session']}")
                        continue
                    rebuilt[(s["year"], s["session"])].append(sig(q.pop(0)))
                else:
                    rebuilt[(s["year"], s["session"])].append(sig(s))
            leftovers = [m for q in fill.values() for m in q]
            if leftovers:
                err(f"{key}: {len(leftovers)} major subjects not placed in the sheet template")
            flat = defaultdict(list)
            for s in slots:
                flat[(s["year"], s["session"])].append(sig(s))
            for ys in set(flat) | set(rebuilt):
                if Counter(flat[ys]) != Counter(rebuilt[ys]):
                    err(f"{key}: Y{ys[0]} {ys[1]} differs between Pathway Data and the degree sheet")
            if sheet_pw[0]["total"] != deg["cp"]:
                err(f"{key}: sheet pathway total {sheet_pw[0]['total']} != {deg['cp']}")

            # ---- choice resolution and catalogue coverage
            seen = Counter()
            for s in slots:
                where = f"{key} Y{s['year']} {s['session']} slot {s['slot']}"
                if s["kind"] == "fixed":
                    seen[s["code"]] += 1
                    if s["code"] not in catalogue:
                        warn(f"{where}: {s['code']} is not in the degree's subject catalogue")
                elif s["kind"] in ("llb", "pool", "option"):
                    pool = [c for comp in s["pool"] for c in components[comp]]
                    usable = [c for c in pool if session_value(c, s["session"]) not in (None, "—")]
                    if not usable:
                        err(f"{where}: pool {s['pool']} has nothing offered in {s['session']}")
                    if s["kind"] == "option":
                        seen[s["code"]] += 1
                        if s["code"] not in {c["code"] for c in usable}:
                            err(f"{where}: default option {s['code']} not offered in {s['session']}")
                elif s["kind"] == "inline":
                    for o in s["options"]:
                        if o["code"] not in catalogue:
                            err(f"{where}: inline option {o['code']} missing from catalogue")
                        else:
                            c = catalogue[o["code"]][0]
                            if session_value(c, s["session"]) in (None, "—"):
                                warn(f"{where}: inline option {o['code']} shows '—' for {s['session']}")
            dupes = [c for c, n in seen.items() if n > 1]
            if dupes:
                err(f"{key}: subjects scheduled twice: {dupes}")

    # ---- additional WSU subject list: added only, never replacing workbook subjects
    extra = d.get("additionalSubjects", [])
    workbook_codes = {c["code"] for deg in d["degrees"] for c in deg["catalogue"]}
    for slots in pathways.values():
        for s in slots:
            workbook_codes.add(s["code"])
            workbook_codes.update(o["code"] for o in s.get("options") or [])
    codes = [x["code"] for x in extra]
    if len(codes) != len(set(codes)):
        err("additional subjects contain repeated codes")
    clash = sorted(set(codes) & workbook_codes)
    if clash:
        err(f"additional subjects duplicate workbook subjects: {clash[:10]}")
    for x in extra:
        if not re.fullmatch(r"[A-Z]{4} \d{4}", x["code"]) or not x["title"] or re.search("[\u200b\u200c\u200d\u2060\ufeff]", x["title"]):
            err(f"malformed additional subject {x}")
    if extra and d["meta"]["counts"].get("additionalSubjects") != len(extra):
        err("additional subject count in meta does not match the list")

    # ---- prerequisites shown by the Chain view: every code must be a real subject
    prereqs = json.loads((Path(__file__).resolve().parent.parent / "data" / "prerequisites.json").read_text(encoding="utf-8"))
    known = workbook_codes | set(codes)
    for code, entry in prereqs["subjects"].items():
        if not entry.get("source"):
            err(f"prerequisites: {code} has no source")
        for c in [code] + [p for group in entry["requires"] for p in group]:
            if c not in known:
                err(f"prerequisites: {c} is not a known subject")
    for seq in prereqs["sequences"]:
        for c in seq["first"]:
            if c not in known:
                err(f"prerequisites: sequence subject {c} is not a known subject")

    for w in warnings:
        print("WARN ", w)
    for e in errors:
        print("ERROR", e)
    c = d["meta"]["counts"]
    print(f"\nChecked {c['degrees']} degrees, {c['pathways']} pathways, {c['pathwayRows']} rows, "
          f"{c['catalogueRows']} catalogue rows, {c.get('additionalSubjects', 0)} additional subjects: {len(errors)} errors, {len(warnings)} warnings")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
