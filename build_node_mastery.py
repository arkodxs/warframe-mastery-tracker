#!/usr/bin/env python3
"""
Regenerate data/node-mastery.json from the WARFRAME wiki's Module:Missions/data.

Build-time only. Nothing here should run in your request path -- commit the
output JSON and load that at runtime.

Usage:
    python build_node_mastery.py                     # write data/node-mastery.json
    python build_node_mastery.py --check             # diff against existing, exit 1 on change
    python build_node_mastery.py --audit             # also report nodes in ExportRegions with no mastery entry
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

WIKI_URL = (
    "https://wiki.warframe.com/api.php"
    "?action=parse&page=Module:Missions/data&prop=wikitext&format=json"
)

EXPORT_REGIONS_URL = (
    "https://raw.githubusercontent.com/calamity-inc/"
    "warframe-public-export/senpai/ExportRegions_en.json"
)

# Be a good citizen -- the wiki asks for a descriptive UA with contact info.
USER_AGENT = "node-mastery-builder/1.0 (https://github.com/you/your-repo)"

OUT_PATH = Path("data/node-mastery.json")

# One node record per { ... } block. Node records nest one level deep
# (NextNodes = { "Baal", "Morax" }), so allow exactly one level.
ENTRY_RE = re.compile(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}")
INTERNAL_NAME_RE = re.compile(r'InternalName\s*=\s*"([^"]+)"')
MASTERY_EXP_RE = re.compile(r"MasteryExp\s*=\s*(\d+)")


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def extract_mastery(wikitext: str) -> dict[str, int]:
    """Pull {InternalName: MasteryExp} out of the Lua source.

    Records without both fields are skipped, which filters out the
    MissionTypes / MissionModifiers tables automatically.
    """
    mastery: dict[str, int] = {}
    conflicts: list[str] = []

    for match in ENTRY_RE.finditer(wikitext):
        record = match.group(0)
        name_match = INTERNAL_NAME_RE.search(record)
        exp_match = MASTERY_EXP_RE.search(record)
        if not (name_match and exp_match):
            continue

        node_id = name_match.group(1)
        value = int(exp_match.group(1))

        if node_id in mastery and mastery[node_id] != value:
            conflicts.append(f"{node_id}: {mastery[node_id]} vs {value}")
        mastery[node_id] = value

    if conflicts:
        print("WARNING: duplicate node IDs with differing values:", file=sys.stderr)
        for line in conflicts:
            print(f"  {line}", file=sys.stderr)

    return mastery


def sort_key(node_id: str) -> tuple[str, int, str]:
    """Sort SolNode2 before SolNode10 instead of lexically."""
    match = re.match(r"^([A-Za-z]+)(\d+)$", node_id)
    if match:
        return (match.group(1), int(match.group(2)), "")
    return (node_id, 0, node_id)


def audit(mastery: dict[str, int]) -> int:
    """Report nodes present in ExportRegions but missing from the mastery map."""
    regions = fetch_json(EXPORT_REGIONS_URL)
    nodes = regions.get("ExportRegions", regions)
    node_ids = {n["uniqueName"] for n in nodes if "uniqueName" in n}

    missing = sorted(node_ids - mastery.keys(), key=sort_key)
    stale = sorted(mastery.keys() - node_ids, key=sort_key)

    if missing:
        print(f"\n{len(missing)} node(s) in ExportRegions with no mastery value:")
        for node_id in missing:
            print(f"  {node_id}")
    if stale:
        print(f"\n{len(stale)} mastery entr(ies) for nodes not in ExportRegions:")
        for node_id in stale:
            print(f"  {node_id}")
    if not missing and not stale:
        print("\nMastery map and ExportRegions agree on node coverage.")

    return 1 if missing else 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true",
                        help="compare against the committed file; exit 1 if it changed")
    parser.add_argument("--audit", action="store_true",
                        help="cross-check coverage against ExportRegions")
    parser.add_argument("--out", type=Path, default=OUT_PATH)
    args = parser.parse_args()

    payload = fetch_json(WIKI_URL)
    wikitext = payload["parse"]["wikitext"]["*"]
    mastery = extract_mastery(wikitext)

    if not mastery:
        print("ERROR: extracted zero entries -- the module format probably changed.",
              file=sys.stderr)
        return 2

    ordered = {k: mastery[k] for k in sorted(mastery, key=sort_key)}
    text = json.dumps(ordered, indent=2) + "\n"

    if args.check:
        if not args.out.exists():
            print(f"{args.out} does not exist yet.")
            return 1
        if args.out.read_text() != text:
            print(f"{args.out} is out of date ({len(ordered)} entries upstream).")
            return 1
        print(f"{args.out} is current ({len(ordered)} entries).")
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(text)
    print(f"Wrote {len(ordered)} entries to {args.out}")

    if args.audit:
        return audit(mastery)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
