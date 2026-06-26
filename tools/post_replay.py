#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request
from pathlib import Path


def read_game(replay: Path, game: int) -> dict:
    with replay.open("r", encoding="utf-8") as f:
        for i, line in enumerate(f):
            if i == game:
                return json.loads(line)
    raise IndexError(f"game {game} not found in {replay}")


def main() -> int:
    p = argparse.ArgumentParser(description="Post saved visualize_data from friend_battle replay jsonl to a visualizer endpoint.")
    p.add_argument("--replay", required=True, help="jsonl produced by tools/friend_battle.py")
    p.add_argument("--game", type=int, default=0)
    p.add_argument("--url", default="https://ptcgvis.heroz.jp/Visualizer/Replay/0", help="visualizer POST URL")
    p.add_argument("--field", default="json", help="form field name expected by the visualizer; default: json")
    p.add_argument("--raw", action="store_true", help="POST raw body instead of x-www-form-urlencoded")
    p.add_argument("--print-only", action="store_true", help="only print payload/curl hint; do not POST")
    args = p.parse_args()

    row = read_game(Path(args.replay), args.game)
    payload = row.get("visualize_data")
    if not payload:
        raise ValueError("selected replay has no visualize_data. Re-run without --no-visualize-data.")

    if args.print_only:
        print(payload)
        print("\n# curl example")
        print(f"curl -X POST --data-urlencode {args.field}@- {args.url}")
        return 0

    if args.raw:
        body = payload.encode("utf-8")
        headers = {"Content-Type": "application/json"}
    else:
        body = urllib.parse.urlencode({args.field: payload}).encode("utf-8")
        headers = {"Content-Type": "application/x-www-form-urlencoded"}

    req = urllib.request.Request(args.url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=30) as res:
        text = res.read().decode("utf-8", errors="replace")
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
