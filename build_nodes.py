#!/usr/bin/env python3
"""
Build data/nodes.json: one record per star chart node, merged from

  - Public Export Plus (ExportRegions, ExportFactions, dict.en): which nodes
    exist in the current game build, plus names, planet, type, faction, levels.
  - The WARFRAME wiki's Module:Missions/data: mastery XP. Trusted over the
    export, which reports 0 XP for every junction (the real value is 1000).

Build-time only. A scheduled GitHub Action runs this and commits the output;
the app loads the committed JSON. Git history is the backup and version log.

Usage:
    python build_nodes.py                       # write data/nodes.json
    python build_nodes.py --report alerts.md    # also write mastery-affecting
                                                # changes vs the previous file
    python build_nodes.py --commit-message m.txt

Exit codes: 0 ok, 2 a source could not be fetched or parsed (nothing written).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WIKI_URL = (
    "https://wiki.warframe.com/api.php"
    "?action=parse&page=Module:Missions/data&prop=wikitext&format=json"
)
EXPORT_BASE = (
    "https://raw.githubusercontent.com/calamity-inc/"
    "warframe-public-export-plus/senpai/"
)
EXPORT_COMMIT_URL = (
    "https://api.github.com/repos/calamity-inc/"
    "warframe-public-export-plus/commits/senpai"
)
PATCHLOGS_URL = (
    "https://raw.githubusercontent.com/WFCD/warframe-patchlogs/master/data/patchlogs.json"
)
WORLDSTATE_URL = "https://api.warframe.com/cdn/worldState.php"

# Be a good citizen -- the wiki asks for a descriptive UA with contact info.
USER_AGENT = "wf-mastery-tracker-node-builder/2.0 (https://github.com/arkodxs/warframe-mastery-tracker)"

OUT_PATH = Path("data/nodes.json")

# One node record per { ... } block. Node records nest one level deep
# (NextNodes = { "Baal", "Morax" }), so allow exactly one level.
ENTRY_RE = re.compile(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}")
INTERNAL_NAME_RE = re.compile(r'InternalName\s*=\s*"([^"]+)"')
MASTERY_EXP_RE = re.compile(r"MasteryExp\s*=\s*(\d+)")
NAME_RE = re.compile(r'\bName\s*=\s*"([^"]+)"')
PLANET_RE = re.compile(r'\bPlanet\s*=\s*"([^"]+)"')
TYPE_RE = re.compile(r'\bType\s*=\s*"([^"]+)"')
ENEMY_RE = re.compile(r'\bEnemy\s*=\s*(?:"([^"]+)"|\{([^{}]*)\})')
MIN_LEVEL_RE = re.compile(r"\bMinLevel\s*=\s*(\d+)")
MAX_LEVEL_RE = re.compile(r"\bMaxLevel\s*=\s*(\d+)")

# Below this share of export node names resolving through dict.en.json,
# assume the dictionary format changed rather than publishing ID-only names.
MIN_NAME_RESOLUTION = 0.9


class SourceError(Exception):
    """A required source could not be fetched or no longer parses."""


def fetch_json(url: str, token: str | None = None):
    headers = {"User-Agent": USER_AGENT}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)


def fetch_required(url: str):
    try:
        return fetch_json(url)
    except Exception as exc:  # network, HTTP or JSON errors all mean "no data"
        raise SourceError(f"could not fetch {url}: {exc}") from exc


def sort_key(node_id: str) -> tuple[str, int, str]:
    """Sort SolNode2 before SolNode10 instead of lexically."""
    match = re.match(r"^([A-Za-z]+)(\d+)$", node_id)
    if match:
        return (match.group(1), int(match.group(2)), "")
    return (node_id, 0, node_id)


def title_case(text: str) -> str:
    """DE's dictionary stores mission types and factions in caps ("MOBILE DEFENSE")."""
    return " ".join(word.capitalize() for word in text.split(" "))


# ── Sources ───────────────────────────────────────────────


def parse_wiki(wikitext: str) -> dict[str, dict]:
    """Pull node records out of the Lua source of Module:Missions/data.

    Only records with an InternalName and a Planet or MasteryExp are nodes;
    that filters out the MissionTypes / MissionModifiers tables.
    """
    nodes: dict[str, dict] = {}
    conflicts: list[str] = []

    for match in ENTRY_RE.finditer(wikitext):
        record = match.group(0)
        id_match = INTERNAL_NAME_RE.search(record)
        exp_match = MASTERY_EXP_RE.search(record)
        planet_match = PLANET_RE.search(record)
        if not id_match or not (exp_match or planet_match):
            continue

        node_id = id_match.group(1)
        enemy_match = ENEMY_RE.search(record)
        enemy = ""
        if enemy_match:
            enemy = enemy_match.group(1) or " / ".join(
                re.findall(r'"([^"]+)"', enemy_match.group(2) or "")
            )
        min_level = MIN_LEVEL_RE.search(record)
        max_level = MAX_LEVEL_RE.search(record)
        name_match = NAME_RE.search(record)
        type_match = TYPE_RE.search(record)

        entry = {
            "name": name_match.group(1) if name_match else "",
            "planet": planet_match.group(1) if planet_match else "",
            "type": type_match.group(1) if type_match else "",
            "enemy": enemy,
            "minLevel": int(min_level.group(1)) if min_level else None,
            "maxLevel": int(max_level.group(1)) if max_level else None,
            "masteryExp": int(exp_match.group(1)) if exp_match else None,
        }

        previous = nodes.get(node_id)
        if previous and previous["masteryExp"] != entry["masteryExp"]:
            conflicts.append(f"{node_id}: {previous['masteryExp']} vs {entry['masteryExp']}")
        nodes[node_id] = entry

    if conflicts:
        print("WARNING: duplicate wiki node IDs with differing XP:", file=sys.stderr)
        for line in conflicts:
            print(f"  {line}", file=sys.stderr)

    return nodes


def fetch_version_meta() -> dict:
    """Readable update name, live game build and export snapshot.

    These label the data for the git log; failing to get them never blocks a
    build, so each falls back to None with a warning.
    """
    meta = {"update": None, "buildLabel": None, "exportCommit": None, "exportDate": None}

    try:
        logs = fetch_json(PATCHLOGS_URL)
        updates = [l for l in logs if l.get("type") == "Update" and l.get("date")]
        if updates:
            meta["update"] = max(updates, key=lambda l: l["date"])["name"]
    except Exception as exc:
        print(f"WARNING: patchlogs unavailable: {exc}", file=sys.stderr)

    try:
        label = fetch_json(WORLDSTATE_URL).get("BuildLabel") or ""
        meta["buildLabel"] = label.split("/")[0] or None
    except Exception as exc:
        print(f"WARNING: worldstate unavailable: {exc}", file=sys.stderr)

    try:
        commit = fetch_json(EXPORT_COMMIT_URL, token=os.environ.get("GITHUB_TOKEN"))
        meta["exportCommit"] = commit["sha"][:12]
        meta["exportDate"] = commit["commit"]["committer"]["date"]
    except Exception as exc:
        print(f"WARNING: export commit unavailable: {exc}", file=sys.stderr)

    return meta


# ── Merge ─────────────────────────────────────────────────


def merge(regions: dict, factions: dict, lang: dict, wiki: dict) -> tuple[dict, list, list]:
    """Apply the per-field source precedence.

    Which nodes exist: the export, plus any wiki node that gives XP.
    A node only one source knows about, with no evidence of XP, is excluded
    (and listed, so exclusions show up in the diff).

    Field          first choice              fallback
    name, planet   export + dict.en          wiki, then the raw ID
    type           export missionName + dict wiki
    enemy          wiki                      export faction + dict
    levels         export                    wiki

    enemy prefers the wiki for player-facing names ("Infested", "Corrupted",
    "Grineer or Corpus") over DE's internal ones ("Infestation", "Orokin").
    masteryExp     wiki                      export (xpSource "export" = unconfirmed)
    """
    nodes: dict[str, dict] = {}
    excluded: list[dict] = []
    disagreements: list[dict] = []

    def translate(key):
        return lang.get(key, "") if key else ""

    for node_id in sorted(set(regions) | set(wiki), key=sort_key):
        exp = regions.get(node_id)
        wk = wiki.get(node_id)

        wiki_xp = wk["masteryExp"] if wk else None
        export_xp = exp.get("masteryExp") if exp else None
        if wiki_xp is not None:
            xp, source = wiki_xp, "wiki"
        elif export_xp is not None:
            xp, source = export_xp, "export"
        else:
            xp, source = 0, "none"

        if not (exp and wk) and xp <= 0:
            excluded.append({"id": node_id, "onlyIn": "export" if exp else "wiki"})
            continue

        if wiki_xp is not None and export_xp and export_xp != wiki_xp:
            disagreements.append({"id": node_id, "wiki": wiki_xp, "export": export_xp})

        exp = exp or {}
        wk = wk or {}
        faction = factions.get(exp.get("faction") or "", {})
        mission_type = translate(exp.get("missionName"))
        enemy = translate(faction.get("name"))
        min_level = exp.get("minEnemyLevel", wk.get("minLevel"))
        max_level = exp.get("maxEnemyLevel", wk.get("maxLevel"))

        nodes[node_id] = {
            "name": translate(exp.get("name")) or wk.get("name") or node_id,
            "planet": translate(exp.get("systemName")) or wk.get("planet") or "",
            "type": title_case(mission_type) if mission_type else wk.get("type", ""),
            "enemy": wk.get("enemy") or (title_case(enemy) if enemy else ""),
            "minLevel": min_level or 0,
            "maxLevel": max_level or 0,
            "masteryExp": xp,
            "xpSource": source,
        }

    return nodes, excluded, disagreements


# ── Change report ─────────────────────────────────────────


def mastery_changes(prev: dict | None, nodes: dict, disagreements: list) -> list[str]:
    """Changes that move someone's mastery total. Empty means no alert."""
    if prev is None:
        return []
    old_nodes = prev.get("nodes", {})
    old_disagreements = {d["id"]: d for d in prev.get("disagreements", [])}
    lines: list[str] = []

    for node_id in sorted(set(old_nodes) | set(nodes), key=sort_key):
        old = old_nodes.get(node_id)
        new = nodes.get(node_id)
        old_xp = old["masteryExp"] if old else 0
        new_xp = new["masteryExp"] if new else 0
        label = (new or old)["name"]

        if old is None and new_xp > 0:
            lines.append(f"- **Added** `{node_id}` ({label}): {new_xp} XP from {new['xpSource']}")
        elif new is None and old_xp > 0:
            lines.append(f"- **Removed** `{node_id}` ({label}): was {old_xp} XP")
        elif old and new and old_xp != new_xp:
            lines.append(f"- **XP changed** `{node_id}` ({label}): {old_xp} → {new_xp} ({new['xpSource']})")

        if new and new["xpSource"] == "export" and new_xp > 0 and (
            old is None or old["xpSource"] != "export"
        ):
            lines.append(f"- **Unconfirmed** `{node_id}` ({label}): {new_xp} XP from the export only; not on the wiki")

    for d in disagreements:
        if old_disagreements.get(d["id"]) != d:
            lines.append(f"- **Sources disagree** `{d['id']}`: wiki {d['wiki']} XP, export {d['export']} XP (wiki used)")

    return lines


def total_xp(nodes: dict) -> int:
    return sum(n["masteryExp"] for n in nodes.values())


# ── Output ────────────────────────────────────────────────


def render(meta: dict, nodes: dict, excluded: list, disagreements: list) -> str:
    """One node per line so git diffs read as a per-node change log."""
    def dumps(value) -> str:
        return json.dumps(value, ensure_ascii=False)

    out = ["{", f'"meta": {json.dumps(meta, ensure_ascii=False, indent=1)},', '"nodes": {']
    items = list(nodes.items())
    for i, (node_id, rec) in enumerate(items):
        out.append(f" {dumps(node_id)}: {dumps(rec)}{',' if i < len(items) - 1 else ''}")
    out.append("},")
    out.append(f'"disagreements": {dumps(disagreements)},')
    out.append('"excluded": [')
    for i, rec in enumerate(excluded):
        out.append(f" {dumps(rec)}{',' if i < len(excluded) - 1 else ''}")
    out.append("]")
    out.append("}")
    return "\n".join(out) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=OUT_PATH)
    parser.add_argument("--report", type=Path,
                        help="write mastery-affecting changes here (only if there are any)")
    parser.add_argument("--commit-message", type=Path,
                        help="write a commit message labelled with the game version here")
    args = parser.parse_args()

    try:
        wiki_payload = fetch_required(WIKI_URL)
        regions = fetch_required(EXPORT_BASE + "ExportRegions.json")
        factions = fetch_required(EXPORT_BASE + "ExportFactions.json")
        lang = fetch_required(EXPORT_BASE + "dict.en.json")

        wikitext = (wiki_payload.get("parse") or {}).get("wikitext", {}).get("*", "")
        wiki = parse_wiki(wikitext)
        if not any(n["masteryExp"] for n in wiki.values()):
            raise SourceError("wiki: no nodes with MasteryExp -- the module format probably changed")
        if not isinstance(regions, dict) or not regions:
            raise SourceError("ExportRegions: no nodes -- the export format probably changed")
        resolved = sum(1 for r in regions.values() if lang.get(r.get("name", "")))
        if resolved < MIN_NAME_RESOLUTION * len(regions):
            raise SourceError(
                f"dict.en: only {resolved}/{len(regions)} node names resolve -- format probably changed"
            )
    except SourceError as exc:
        print(f"ERROR: {exc}. Nothing written; the previous file stays live.", file=sys.stderr)
        return 2

    nodes, excluded, disagreements = merge(regions, factions, lang, wiki)

    prev = None
    if args.out.exists():
        prev = json.loads(args.out.read_text(encoding="utf-8"))

    changes = mastery_changes(prev, nodes, disagreements)
    data_changed = prev is None or (
        prev.get("nodes") != nodes
        or prev.get("excluded") != excluded
        or prev.get("disagreements") != disagreements
    )

    version = fetch_version_meta()
    meta = {
        **version,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "nodeCount": len(nodes),
        "xpNodeCount": sum(1 for n in nodes.values() if n["masteryExp"] > 0),
        "totalXp": total_xp(nodes),
    }

    # Only rewrite when the data changed, so commits (and the version label on
    # them) mark real data changes rather than every scheduled run.
    if data_changed:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(render(meta, nodes, excluded, disagreements), encoding="utf-8")
        print(f"Wrote {len(nodes)} nodes ({meta['xpNodeCount']} give XP, "
              f"{meta['totalXp']} XP total) to {args.out}")
    else:
        print(f"{args.out} is current ({len(nodes)} nodes); not rewritten.")

    if args.commit_message:
        label = version["update"] or "unknown update"
        build = f" (build {version['buildLabel']})" if version["buildLabel"] else ""
        body = [f"data: nodes for {label}{build}", ""]
        body.append(f"{meta['nodeCount']} nodes, {meta['xpNodeCount']} give XP, {meta['totalXp']} XP total.")
        if version["exportCommit"]:
            body.append(f"Export snapshot {version['exportCommit']} ({version['exportDate']}).")
        if changes:
            body.append("")
            body.extend(changes)
        args.commit_message.write_text("\n".join(body) + "\n", encoding="utf-8")

    if args.report and changes:
        old_total = total_xp(prev.get("nodes", {})) if prev else 0
        report = [
            f"The scheduled node build found changes that affect mastery totals "
            f"({old_total} → {meta['totalXp']} XP per star chart pass).",
            "",
            f"Update: {version['update'] or 'unknown'} · build {version['buildLabel'] or 'unknown'} · "
            f"export {version['exportCommit'] or 'unknown'} ({version['exportDate'] or 'unknown'})",
            "",
            *changes,
        ]
        args.report.write_text("\n".join(report) + "\n", encoding="utf-8")
        print(f"{len(changes)} mastery-affecting change(s) written to {args.report}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
