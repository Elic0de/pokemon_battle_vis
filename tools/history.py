#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
RUNS_DIR = ROOT / "runs"
INDEX_PATH = RUNS_DIR / "index.jsonl"


def iter_runs() -> list[dict[str, Any]]:
    if not INDEX_PATH.exists():
        return []
    rows: list[dict[str, Any]] = []
    with INDEX_PATH.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    rows.sort(key=lambda r: str(r.get("started_at", "")), reverse=True)
    return rows


def short_path(value: str | None) -> str:
    if not value:
        return ""
    try:
        p = Path(value)
        if p.is_absolute():
            return str(p.relative_to(ROOT))
    except Exception:
        pass
    return value


def print_runs(rows: list[dict[str, Any]], limit: int) -> None:
    if not rows:
        print("no history yet. run tools/friend_battle.py first.")
        return
    rows = rows[:limit]
    headers = ["run_id", "started", "matchup", "games", "W-L-D", "winrate", "replay"]
    table: list[list[str]] = [headers]
    for r in rows:
        games = int(r.get("games", 0) or 0)
        w0 = int(r.get("agent0_wins", 0) or 0)
        w1 = int(r.get("agent1_wins", 0) or 0)
        d = int(r.get("draws", 0) or 0)
        wr = (w0 / games * 100.0) if games else 0.0
        matchup = f"{r.get('agent0_name','agent0')} vs {r.get('agent1_name','agent1')}"
        table.append([
            str(r.get("run_id", ""))[:19],
            str(r.get("started_at", ""))[:19],
            matchup,
            str(games),
            f"{w0}-{w1}-{d}",
            f"{wr:.1f}%",
            short_path(str(r.get("replay", ""))),
        ])
    widths = [max(len(row[i]) for row in table) for i in range(len(headers))]
    for idx, row in enumerate(table):
        print("  ".join(cell.ljust(widths[i]) for i, cell in enumerate(row)))
        if idx == 0:
            print("  ".join("-" * w for w in widths))


def find_run(run_id: str) -> dict[str, Any]:
    matches = [r for r in iter_runs() if str(r.get("run_id", "")).startswith(run_id)]
    if not matches:
        raise SystemExit(f"run not found: {run_id}")
    if len(matches) > 1:
        raise SystemExit(f"run id is ambiguous: {run_id}")
    return matches[0]


def read_replay_rows(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def print_detail(run_id: str) -> None:
    r = find_run(run_id)
    print(json.dumps(r, ensure_ascii=False, indent=2))
    replay = Path(str(r.get("replay", "")))
    if not replay.is_absolute():
        replay = ROOT / replay
    if replay.exists():
        print("\n# games")
        print("game  winner  steps  swapped  reason")
        print("----  ------  -----  -------  ------")
        for row in read_replay_rows(replay):
            print(f"{row.get('game', '')!s:<4}  {row.get('winner', '')!s:<6}  {row.get('steps', '')!s:<5}  {str(row.get('seat_swapped', '')):<7}  {row.get('reason', '')}")


def main() -> int:
    p = argparse.ArgumentParser(description="List and inspect friend battle history.")
    sub = p.add_subparsers(dest="cmd")
    p_list = sub.add_parser("list", help="list recent runs")
    p_list.add_argument("--limit", type=int, default=20)
    p_show = sub.add_parser("show", help="show run detail and games")
    p_show.add_argument("run_id", help="full or prefix run id")
    p_latest = sub.add_parser("latest", help="print latest run id/replay for scripts")
    args = p.parse_args()

    if args.cmd in (None, "list"):
        print_runs(iter_runs(), getattr(args, "limit", 20))
        return 0
    if args.cmd == "show":
        print_detail(args.run_id)
        return 0
    if args.cmd == "latest":
        rows = iter_runs()
        if not rows:
            raise SystemExit("no history yet")
        r = rows[0]
        print(f"run_id={r.get('run_id')}")
        print(f"replay={short_path(str(r.get('replay', '')))}")
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
