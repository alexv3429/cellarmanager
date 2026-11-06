"""Read-only comparison of two producer exchange bundles and an old-row audit.

Usage: python3 reconcile_producer_profile_bundles.py OLD_DIR NEW_DIR AUDIT_CSV

The output describes research candidates, not approved drinking windows or
canonical cellar matches. No input file or database is modified.
"""

import csv
import json
import sys
from collections import Counter
from pathlib import Path


MILESTONES = ("first_trial_year", "best_start_year", "best_end_year")


def load_profiles(directory):
    profiles = {}
    for path in sorted(Path(directory).glob("*.json")):
        document = json.loads(path.read_text(encoding="utf-8"))
        if document.get("format") != "cellarmanager.producer_research":
            continue
        producer_id = document["producer"]["id"]
        if producer_id in profiles:
            raise ValueError(f"Duplicate producer ID: {producer_id}")
        profiles[producer_id] = document
    return profiles


def rows_by_release(document):
    rows = {}
    for row in document["exact_release_calibrations"]:
        key = (row["cuvee_id"], row["vintage"], row["format_ml"])
        if key in rows:
            raise ValueError(f"Duplicate release in {document['producer']['id']}: {key}")
        rows[key] = row
    return rows


def milestones(row):
    return [row["proposal"][field] for field in MILESTONES]


def audit_lookup(path):
    rows = {}
    with open(path, encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source, delimiter=";"):
            key = (row["producteur"], row["cuvee"],
                   int(row["millesime"]), int(row["format_ml"]),
                   row["dates_precedentes"])
            if key in rows:
                raise ValueError(f"Duplicate audit entry: {key}")
            rows[key] = row
    return rows


def compare(old_directory, new_directory, audit_path):
    old_profiles = load_profiles(old_directory)
    new_profiles = load_profiles(new_directory)
    audit = audit_lookup(audit_path)
    if not set(old_profiles).issubset(new_profiles):
        raise ValueError("A previously archived producer is missing entirely")

    totals = Counter()
    reason_totals = Counter()
    producers = []
    changed_rows = []
    missing_audit = []
    for producer_id, old in sorted(old_profiles.items()):
        new = new_profiles[producer_id]
        old_rows = rows_by_release(old)
        new_rows = rows_by_release(new)
        cuvee_names = {item["id"]: item["name"] for item in old["cuvees"]}
        counts = Counter()
        reasons = Counter()
        for key, old_row in old_rows.items():
            cuvee_id, vintage, format_ml = key
            new_row = new_rows.get(key)
            if new_row is None:
                counts["absent"] += 1
                old_dates = milestones(old_row)
                audit_key = (old["producer"]["name"], cuvee_names[cuvee_id],
                             vintage, format_ml, " / ".join(map(str, old_dates)))
                audit_row = audit.get(audit_key)
                if audit_row is None:
                    missing_audit.append({"producer": old["producer"]["name"],
                                          "cuvee": cuvee_names[cuvee_id],
                                          "vintage": vintage, "format_ml": format_ml})
                else:
                    reasons[audit_row["decision"]] += 1
                continue
            if milestones(old_row) == milestones(new_row):
                counts["unchanged"] += 1
            else:
                counts["changed"] += 1
                changed_rows.append({"producer": old["producer"]["name"],
                                     "cuvee": cuvee_names[cuvee_id],
                                     "vintage": vintage, "format_ml": format_ml,
                                     "old": milestones(old_row),
                                     "new": milestones(new_row)})
        counts["new_within_existing_producer"] = len(new_rows.keys() - old_rows.keys())
        counts["old"] = len(old_rows)
        counts["new"] = len(new_rows)
        totals.update(counts)
        reason_totals.update(reasons)
        producers.append({"producer": old["producer"]["name"],
                          "producer_id": producer_id, **dict(counts),
                          "absent_reasons": dict(reasons)})

    new_only_profiles = {producer_id: len(rows_by_release(document))
                         for producer_id, document in new_profiles.items()
                         if producer_id not in old_profiles}
    if totals["old"] != totals["unchanged"] + totals["changed"] + totals["absent"]:
        raise ValueError("Old-row accounting does not reconcile")
    if totals["new"] + sum(new_only_profiles.values()) != sum(
            len(rows_by_release(document)) for document in new_profiles.values()):
        raise ValueError("New-row accounting does not reconcile")
    return {"old_producers": len(old_profiles), "new_producers": len(new_profiles),
            "totals": dict(totals), "absent_audit_decisions": dict(reason_totals),
            "absent_without_audit": missing_audit, "changed_rows": changed_rows,
            "new_only_profile_rows": new_only_profiles, "producers": producers}


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    print(json.dumps(compare(*sys.argv[1:]), ensure_ascii=False, indent=2))
