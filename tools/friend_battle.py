#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import random
import sys
import time
import traceback
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from cg.game import battle_finish, battle_select, battle_start, visualize_data  # noqa: E402

AgentFn = Callable[[dict[str, Any]], list[int]]


@dataclass
class LoadedAgent:
    name: str
    path: Path
    agent_fn: AgentFn
    deck: list[int]
    local_module_roots: set[str]
    local_modules: dict[str, ModuleType]


@contextmanager
def pushd(path: Path):
    old = Path.cwd()
    os.chdir(path)
    try:
        yield
    finally:
        os.chdir(old)


def read_deck(path: Path) -> list[int]:
    deck_path = path / "deck.csv"
    rows = [line.strip() for line in deck_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    deck = [int(x) for x in rows]
    if len(deck) != 60:
        raise ValueError(f"{deck_path}: deck must be 60 cards, got {len(deck)}")
    return deck


def local_module_roots(agent_dir: Path) -> set[str]:
    roots = {path.stem for path in agent_dir.glob("*.py") if path.name != "main.py"}
    roots.update(path.name for path in agent_dir.iterdir() if path.is_dir() and (path / "__init__.py").is_file())
    # cg is the shared native game engine. Reloading per agent reinitializes its
    # global buffers; only submission-owned helper packages are isolated.
    roots.discard("cg")
    return roots


def matching_modules(roots: set[str]) -> dict[str, ModuleType]:
    return {
        name: module
        for name, module in sys.modules.items()
        if module is not None and name.split(".", 1)[0] in roots
    }


@contextmanager
def agent_module_scope(agent: LoadedAgent):
    saved = matching_modules(agent.local_module_roots)
    for name in saved:
        sys.modules.pop(name, None)
    sys.modules.update(agent.local_modules)
    try:
        yield
    finally:
        agent.local_modules = matching_modules(agent.local_module_roots)
        for name in list(agent.local_modules):
            sys.modules.pop(name, None)
        sys.modules.update(saved)


def load_agent(agent_dir: Path, name: str) -> LoadedAgent:
    agent_dir = agent_dir.resolve()
    main_path = agent_dir / "main.py"
    if not main_path.exists():
        raise FileNotFoundError(f"missing {main_path}")
    if not (agent_dir / "deck.csv").exists():
        raise FileNotFoundError(f"missing {agent_dir / 'deck.csv'}")

    module_name = f"friend_agent_{name}_{abs(hash(str(agent_dir))) & 0xffffffff}"
    spec = importlib.util.spec_from_file_location(module_name, main_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {main_path}")
    module = importlib.util.module_from_spec(spec)
    roots = local_module_roots(agent_dir)
    saved_modules = matching_modules(roots)
    for module_name_to_remove in saved_modules:
        sys.modules.pop(module_name_to_remove, None)
    old_path = list(sys.path)
    sys.path.insert(0, str(agent_dir))
    loaded_modules: dict[str, ModuleType] = {}
    try:
        # importlib normally registers a module before executing it. Dataclasses
        # and some typing helpers resolve annotations through sys.modules while
        # the class body is being created, so the manual loader must do the same.
        sys.modules[module_name] = module
        with pushd(agent_dir):
            spec.loader.exec_module(module)
        loaded_modules = matching_modules(roots)
    finally:
        sys.modules.pop(module_name, None)
        sys.path[:] = old_path
        for module_name_to_remove in matching_modules(roots):
            sys.modules.pop(module_name_to_remove, None)
        sys.modules.update(saved_modules)

    fn = getattr(module, "agent", None)
    if not callable(fn):
        raise AttributeError(f"{main_path} must define callable agent(obs)")
    return LoadedAgent(
        name=name,
        path=agent_dir,
        agent_fn=fn,
        deck=read_deck(agent_dir),
        local_module_roots=roots,
        local_modules=loaded_modules,
    )


def safe_call_agent(agent: LoadedAgent, obs: dict[str, Any]) -> list[int]:
    with agent_module_scope(agent):
        with pushd(agent.path):
            action = agent.agent_fn(obs)
    if not isinstance(action, list) or not all(isinstance(i, int) for i in action):
        raise ValueError(f"{agent.name}.agent(obs) returned non-list[int]: {action!r}")
    return action


def result_from_obs(obs: dict[str, Any]) -> tuple[int, int | None]:
    cur = obs.get("current") or {}
    result = cur.get("result", -1)
    reason = None
    for log in reversed(obs.get("logs") or []):
        if log.get("type") == 23:  # LogType.RESULT
            result = log.get("result", result)
            reason = log.get("reason")
            break
    return int(result), reason


def enriched_visualize_data(
    keep_visualize: bool,
    obs_log: list[Any],
    action_log: list[list[int] | None],
) -> str | None:
    """Attach the exact Agent input and selected action to visualizer frames."""
    if not keep_visualize:
        return None
    payload = visualize_data()
    try:
        frames = json.loads(payload)
    except json.JSONDecodeError:
        return payload
    if not isinstance(frames, list):
        return payload
    for index, frame in enumerate(frames):
        if not isinstance(frame, dict):
            continue
        observation = obs_log[index] if index < len(obs_log) else ""
        action = action_log[index] if index < len(action_log) else None
        frame["obs"] = observation
        frame["action"] = [action, action]
    return json.dumps(frames, ensure_ascii=False, separators=(",", ":"))


def play_one(agent0: LoadedAgent, agent1: LoadedAgent, max_steps: int, keep_visualize: bool) -> dict[str, Any]:
    obs = None
    started = False
    transcript: list[dict[str, Any]] = []
    obs_log: list[Any] = [""]
    action_log: list[list[int] | None] = [None]
    try:
        obs, start_data = battle_start(agent0.deck, agent1.deck)
        started = True
        if obs is None:
            return {
                "result": 1 if start_data.errorPlayer == 0 else 0,
                "reason": f"battle_start_error player={start_data.errorPlayer} type={start_data.errorType}",
                "steps": 0,
                "first_player": None,
                "actions": [],
                "visualize_data": None,
            }

        for step in range(max_steps):
            cur = obs.get("current") or {}
            if int(cur.get("result", -1)) != -1:
                break
            your_index = int(cur.get("yourIndex", 0))
            current_agent = agent0 if your_index == 0 else agent1
            action = safe_call_agent(current_agent, obs)
            logged_obs = dict(obs)
            logged_obs.pop("search_begin_input", None)
            obs_log.append(logged_obs)
            action_log.append(action)
            transcript.append({"step": step, "player": your_index, "agent": current_agent.name, "action": action})
            obs = battle_select(action)
        else:
            return {
                "result": 2,
                "reason": f"max_steps_{max_steps}",
                "steps": max_steps,
                "first_player": (obs.get("current") or {}).get("firstPlayer") if isinstance(obs, dict) else None,
                "actions": transcript,
                "visualize_data": enriched_visualize_data(keep_visualize, obs_log, action_log),
            }

        result, reason = result_from_obs(obs)
        return {
            "result": result,
            "reason": reason,
            "steps": len(transcript),
            "first_player": (obs.get("current") or {}).get("firstPlayer") if isinstance(obs, dict) else None,
            "actions": transcript,
            "visualize_data": enriched_visualize_data(keep_visualize, obs_log, action_log),
        }
    except Exception as exc:
        # If an agent crashes or returns illegal action, that side loses when known.
        loser = None
        if obs and isinstance(obs.get("current"), dict):
            loser = int(obs["current"].get("yourIndex", 0))
        return {
            "result": 1 - loser if loser in (0, 1) else 2,
            "reason": "error",
            "error": repr(exc),
            "traceback": traceback.format_exc(limit=8),
            "steps": len(transcript),
            "first_player": (obs.get("current") or {}).get("firstPlayer") if isinstance(obs, dict) else None,
            "actions": transcript,
            "visualize_data": enriched_visualize_data(keep_visualize, obs_log, action_log) if started else None,
        }
    finally:
        if started:
            try:
                battle_finish()
            except Exception:
                pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Run quick friend battles between two Kaggle-style PTCG agents.")
    parser.add_argument("--agent0", default="agents/me", help="agent0 directory containing main.py and deck.csv")
    parser.add_argument("--agent1", default="agents/friend", help="agent1 directory containing main.py and deck.csv")
    parser.add_argument("--games", type=int, default=1)
    parser.add_argument("--max-steps", type=int, default=2000)
    parser.add_argument("--out", default="replays/friend_battle.jsonl", help="replay jsonl output path")
    parser.add_argument("--no-visualize-data", action="store_true", help="do not store VisualizeData payload")
    parser.add_argument("--swap", action="store_true", help="play half the games with seats swapped")
    args = parser.parse_args()

    out_path = (ROOT / args.out).resolve() if not Path(args.out).is_absolute() else Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    runs_dir = ROOT / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)

    a0 = load_agent((ROOT / args.agent0) if not Path(args.agent0).is_absolute() else Path(args.agent0), "agent0")
    a1 = load_agent((ROOT / args.agent1) if not Path(args.agent1).is_absolute() else Path(args.agent1), "agent1")

    wins = {0: 0, 1: 0, 2: 0}
    rows: list[dict[str, Any]] = []
    start_ts = time.strftime("%Y-%m-%dT%H:%M:%S")
    run_started_perf = time.perf_counter()
    run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    keep_vis = not args.no_visualize_data

    for game_idx in range(args.games):
        seat_swapped = bool(args.swap and game_idx % 2 == 1)
        left, right = (a1, a0) if seat_swapped else (a0, a1)
        game_started_at = time.strftime("%Y-%m-%dT%H:%M:%S")
        game_started_perf = time.perf_counter()
        row = play_one(left, right, args.max_steps, keep_vis)
        game_finished_at = time.strftime("%Y-%m-%dT%H:%M:%S")
        game_duration_seconds = time.perf_counter() - game_started_perf
        raw_result = row["result"]
        # Normalize result back to original --agent0/--agent1 names.
        if raw_result in (0, 1) and seat_swapped:
            norm_result = 1 - raw_result
        else:
            norm_result = raw_result
        raw_first_player = row.get("first_player")
        if raw_first_player in (0, 1):
            norm_first_player = 1 - raw_first_player if seat_swapped else raw_first_player
        else:
            norm_first_player = None
        wins[norm_result] += 1
        row.update({
            "run_id": run_id,
            "game": game_idx,
            "started_at": game_started_at,
            "finished_at": game_finished_at,
            "duration_seconds": round(game_duration_seconds, 3),
            "seat_swapped": seat_swapped,
            "first_player_raw": raw_first_player,
            "first_player": norm_first_player,
            "agent0": str(a0.path),
            "agent1": str(a1.path),
            "agent0_name": Path(args.agent0).name or "agent0",
            "agent1_name": Path(args.agent1).name or "agent1",
            "winner": norm_result,
        })
        rows.append(row)
        print(f"game {game_idx+1}/{args.games}: winner={norm_result} steps={row.get('steps')} reason={row.get('reason')}")

    with out_path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    summary = {
        "run_id": run_id,
        "started_at": start_ts,
        "finished_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "duration_seconds": round(time.perf_counter() - run_started_perf, 3),
        "agent0": str(a0.path),
        "agent1": str(a1.path),
        "agent0_name": Path(args.agent0).name or "agent0",
        "agent1_name": Path(args.agent1).name or "agent1",
        "games": args.games,
        "agent0_wins": wins[0],
        "agent1_wins": wins[1],
        "draws": wins[2],
        "swap": bool(args.swap),
        "max_steps": args.max_steps,
        "replay": str(out_path),
    }
    summary_path = runs_dir / f"{run_id}.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    with (runs_dir / "index.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(summary, ensure_ascii=False) + "\n")

    print("\n=== result ===")
    print(f"run_id: {run_id}")
    print(f"agent0 wins: {wins[0]}")
    print(f"agent1 wins: {wins[1]}")
    print(f"draw/error-unknown: {wins[2]}")
    print(f"replay jsonl: {out_path}")
    print(f"history: {summary_path}")
    if keep_vis:
        print("view one replay by posting its visualize_data payload with:")
        print(f"  python tools/post_replay.py --replay {out_path} --game 0 --url <VISUALIZER_POST_URL>")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
