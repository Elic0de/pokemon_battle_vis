#!/usr/bin/env python3
from __future__ import annotations

import html
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import threading
import time
import traceback
import urllib.parse
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from deck_preview import card_catalog, deck_summary, render_card_image, render_deck_preview

try:
    from flask import Flask, Response, flash, jsonify, redirect, render_template_string, request, send_file, url_for
    from werkzeug.utils import secure_filename
except ImportError as exc:  # pragma: no cover
    raise SystemExit("Flask is not installed. Run: pip install flask") from exc

ROOT = Path(__file__).resolve().parent
RUNS_DIR = ROOT / "runs"
INDEX_PATH = RUNS_DIR / "index.jsonl"
REPLAYS_DIR = ROOT / "replays"
JOBS_REPLAY_DIR = REPLAYS_DIR / "jobs"
AGENTS_DIR = ROOT / "agents"
DECKS_DIR = ROOT / "decks"
UPLOADS_DIR = ROOT / "uploads"
DB_PATH = ROOT / "history.db"

DEFAULT_AUTO_GAMES = int(os.environ.get("AUTO_MATCH_GAMES", "20"))
DEFAULT_IMMEDIATE_GAMES = int(os.environ.get("IMMEDIATE_MATCH_GAMES", "10"))
DEFAULT_SELF_CHECK_GAMES = int(os.environ.get("SELF_CHECK_GAMES", os.environ.get("SANITY_CHECK_GAMES", "2")))
DEFAULT_AUTO_OPPONENTS = int(os.environ.get("AUTO_MATCH_OPPONENTS", "5"))
DEFAULT_MAX_STEPS = int(os.environ.get("FRIEND_BATTLE_MAX_STEPS", "2000"))
TOURNAMENT_REPLAY_RETENTION = max(0, int(os.environ.get("FRIEND_BATTLE_TOURNAMENT_REPLAY_RETENTION", "2")))
DEFAULT_SWAP = os.environ.get("FRIEND_BATTLE_SWAP", "1") != "0"
AUTO_MATCH_ENABLED = os.environ.get("AUTO_MATCH_ENABLED", "1") != "0"
SELF_CHECK_ENABLED = os.environ.get("SELF_CHECK_ENABLED", os.environ.get("SANITY_CHECK_ENABLED", "1")) != "0"
WORKER_ENABLED = os.environ.get("FRIEND_BATTLE_WORKER", "1") != "0"
WORKER_POLL_SECONDS = float(os.environ.get("FRIEND_BATTLE_WORKER_POLL", "2.0"))
MAX_UPLOAD_BYTES = int(os.environ.get("FRIEND_BATTLE_MAX_UPLOAD_MB", "50")) * 1024 * 1024
ELO_INITIAL = float(os.environ.get("FRIEND_BATTLE_ELO_INITIAL", "600"))
ELO_K = float(os.environ.get("FRIEND_BATTLE_ELO_K", "32"))
VISUALIZER_POST_URL = os.environ.get("VISUALIZER_POST_URL", "https://ptcgvis.heroz.jp/Visualizer/Replay/0")
VISUALIZER_FIELD = os.environ.get("VISUALIZER_FIELD", "json")

JOB_TYPE_IMMEDIATE = "immediate"
JOB_TYPE_SELF_CHECK = "self_check"
JOB_TYPE_MANUAL = "manual"
JOB_TYPE_AUTO = "auto"
JOB_PRIORITIES = {
    JOB_TYPE_IMMEDIATE: 0,
    JOB_TYPE_SELF_CHECK: 1,
    "self-check": 1,
    "sanity": 1,  # backward compatible alias for older DB rows
    JOB_TYPE_MANUAL: 5,
    JOB_TYPE_AUTO: 10,
}

app = Flask(__name__)
app.secret_key = os.environ.get("FRIEND_BATTLE_SECRET", "friend-battle-dev")
_battle_operation_lock = threading.Lock()

BASE_CSS = """
<style>
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:24px;background:#f7f7f8;color:#111}
a{color:#2454d6;text-decoration:none} a:hover{text-decoration:underline}
.card{background:white;border:1px solid #ddd;border-radius:12px;padding:16px;margin:14px 0;box-shadow:0 1px 3px #0001}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:end}.row>*{flex:1;min-width:180px}.row.compact>*{min-width:120px}
label{display:block;font-size:13px;color:#555;margin-bottom:4px}input,select{width:100%;padding:9px;border:1px solid #ccc;border-radius:8px;background:white;box-sizing:border-box}
button,.btn{display:inline-block;padding:9px 13px;border:0;border-radius:8px;background:#111;color:white;cursor:pointer;font-size:14px}.btn.secondary,button.secondary{background:#555}.btn.light{background:#e9e9ee;color:#111}.btn.danger{background:#b00020}
table{width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden}th,td{padding:10px;border-bottom:1px solid #eee;text-align:left;font-size:14px;vertical-align:top}th{background:#f0f0f3;color:#333}.muted{color:#666}.ok{color:#0a7a22}.bad{color:#b00020}.warn{color:#9a5a00}
.pill{display:inline-block;padding:2px 8px;border-radius:99px;background:#eee;font-size:12px}.pill.queued{background:#e8ecff}.pill.running{background:#fff3cd}.pill.done{background:#e4f7e8}.pill.failed{background:#ffe2e2}
pre{white-space:pre-wrap;background:#111;color:#eee;padding:12px;border-radius:8px;overflow:auto}.flash{background:#fff3cd;border:1px solid #ffe08a;padding:10px;border-radius:8px;margin:8px 0}.topnav{display:flex;gap:10px;align-items:center;margin-bottom:18px}.topnav a{background:white;border:1px solid #ddd;border-radius:8px;padding:8px 10px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}.metric{font-size:28px;font-weight:700}.small{font-size:12px}.nowrap{white-space:nowrap}
</style>
"""


def now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def duration_seconds(started_at: Any, finished_at: Any) -> float | None:
    if not started_at or not finished_at:
        return None
    try:
        return max(0.0, (datetime.fromisoformat(str(finished_at)) - datetime.fromisoformat(str(started_at))).total_seconds())
    except (TypeError, ValueError):
        return None


def esc(value: Any) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def page(title: str, body: str, refresh_seconds: int | None = None) -> str:
    refresh = f"<meta http-equiv='refresh' content='{refresh_seconds}'>" if refresh_seconds else ""
    return f"""<!doctype html><meta charset='utf-8'>{refresh}<title>{esc(title)}</title>{BASE_CSS}
<div class='topnav'><strong>Friend Battle</strong><a href='{url_for('index')}'>Dashboard</a><a href='{url_for('ranking')}'>Ranking</a><a href='{url_for('agents')}'>Agents</a><a href='{url_for('jobs')}'>Jobs</a><a href='{url_for('runs')}'>履歴</a></div>
{{% with messages = get_flashed_messages() %}}{{% if messages %}}{{% for m in messages %}}<div class='flash'>{{{{m}}}}</div>{{% endfor %}}{{% endif %}}{{% endwith %}}
{body}"""


def rel(path: str | Path) -> str:
    p = Path(path)
    try:
        if p.is_absolute():
            return str(p.relative_to(ROOT))
    except Exception:
        pass
    return str(p)


def ensure_dirs() -> None:
    for p in (RUNS_DIR, REPLAYS_DIR, JOBS_REPLAY_DIR, AGENTS_DIR, DECKS_DIR, UPLOADS_DIR):
        p.mkdir(parents=True, exist_ok=True)


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    ensure_dirs()
    with db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS agents (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              source TEXT NOT NULL,
              path TEXT NOT NULL,
              upload_path TEXT,
              original_filename TEXT,
              sha256 TEXT,
              status TEXT NOT NULL DEFAULT 'ready',
              error TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS jobs (
              id TEXT PRIMARY KEY,
              agent0_id TEXT NOT NULL,
              agent1_id TEXT NOT NULL,
              games INTEGER NOT NULL,
              max_steps INTEGER NOT NULL,
              swap INTEGER NOT NULL,
              job_type TEXT NOT NULL DEFAULT 'auto',
              priority INTEGER NOT NULL DEFAULT 10,
              status TEXT NOT NULL,
              replay_path TEXT,
              run_id TEXT,
              result_json TEXT,
              stdout TEXT,
              stderr TEXT,
              error TEXT,
              created_at TEXT NOT NULL,
              started_at TEXT,
              finished_at TEXT,
              FOREIGN KEY(agent0_id) REFERENCES agents(id),
              FOREIGN KEY(agent1_id) REFERENCES agents(id)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_status_priority_created ON jobs(status, priority, created_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_agents ON jobs(agent0_id, agent1_id)")

        def ensure_column(table: str, name: str, ddl: str) -> None:
            cols = {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
            if name not in cols:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")

        ensure_column("agents", "elo", f"REAL NOT NULL DEFAULT {ELO_INITIAL}")
        ensure_column("agents", "games", "INTEGER NOT NULL DEFAULT 0")
        ensure_column("agents", "wins", "INTEGER NOT NULL DEFAULT 0")
        ensure_column("agents", "losses", "INTEGER NOT NULL DEFAULT 0")
        ensure_column("agents", "draws", "INTEGER NOT NULL DEFAULT 0")
        ensure_column("agents", "first_games", "INTEGER NOT NULL DEFAULT 0")
        ensure_column("agents", "first_wins", "INTEGER NOT NULL DEFAULT 0")
        ensure_column("agents", "second_games", "INTEGER NOT NULL DEFAULT 0")
        ensure_column("agents", "second_wins", "INTEGER NOT NULL DEFAULT 0")
        ensure_column("jobs", "job_type", "TEXT NOT NULL DEFAULT 'auto'")
        ensure_column("jobs", "priority", "INTEGER NOT NULL DEFAULT 10")
        ensure_column("jobs", "elo_applied", "INTEGER NOT NULL DEFAULT 0")
        ensure_column("jobs", "tournament_id", "TEXT")
        conn.execute("UPDATE jobs SET job_type='auto', priority=10 WHERE job_type IS NULL OR job_type=''")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS elo_games (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              job_id TEXT NOT NULL,
              run_id TEXT NOT NULL,
              game_index INTEGER NOT NULL,
              agent0_id TEXT NOT NULL,
              agent1_id TEXT NOT NULL,
              winner_agent_id TEXT,
              draw INTEGER NOT NULL DEFAULT 0,
              first_agent_id TEXT,
              second_agent_id TEXT,
              steps INTEGER,
              reason TEXT,
              elo0_before REAL NOT NULL,
              elo1_before REAL NOT NULL,
              elo0_after REAL NOT NULL,
              elo1_after REAL NOT NULL,
              created_at TEXT NOT NULL,
              UNIQUE(run_id, game_index),
              FOREIGN KEY(agent0_id) REFERENCES agents(id),
              FOREIGN KEY(agent1_id) REFERENCES agents(id)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_elo_games_agent0 ON elo_games(agent0_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_elo_games_agent1 ON elo_games(agent1_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_elo_games_run ON elo_games(run_id, game_index)")
        ensure_column("elo_games", "tournament_id", "TEXT")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tournaments (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              status TEXT NOT NULL,
              games_per_match INTEGER NOT NULL,
              max_steps INTEGER NOT NULL,
              swap INTEGER NOT NULL,
              participant_count INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              started_at TEXT,
              completed_at TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tournament_agents (
              tournament_id TEXT NOT NULL,
              agent_id TEXT NOT NULL,
              name TEXT NOT NULL,
              source TEXT,
              path TEXT,
              seed INTEGER NOT NULL,
              elo REAL NOT NULL,
              games INTEGER NOT NULL DEFAULT 0,
              wins INTEGER NOT NULL DEFAULT 0,
              losses INTEGER NOT NULL DEFAULT 0,
              draws INTEGER NOT NULL DEFAULT 0,
              first_games INTEGER NOT NULL DEFAULT 0,
              first_wins INTEGER NOT NULL DEFAULT 0,
              second_games INTEGER NOT NULL DEFAULT 0,
              second_wins INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY(tournament_id, agent_id),
              FOREIGN KEY(tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_tournament ON jobs(tournament_id, status)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_elo_games_tournament ON elo_games(tournament_id, id)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS deck_library (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              path TEXT NOT NULL,
              source_type TEXT NOT NULL DEFAULT 'created',
              source_id TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )
            """
        )

        old_games = int(conn.execute("SELECT COUNT(*) FROM elo_games WHERE tournament_id IS NULL").fetchone()[0])
        old_jobs = int(conn.execute("SELECT COUNT(*) FROM jobs WHERE tournament_id IS NULL").fetchone()[0])
        legacy_exists = conn.execute("SELECT 1 FROM tournaments WHERE id='legacy'").fetchone()
        if (old_games or old_jobs) and not legacy_exists:
            created_at = conn.execute("SELECT MIN(created_at) FROM jobs").fetchone()[0] or now_iso()
            conn.execute(
                """
                INSERT INTO tournaments(id,name,status,games_per_match,max_steps,swap,participant_count,created_at,started_at,completed_at)
                VALUES('legacy','Legacy Tournament','completed',?,?,?,?,?,?,?)
                """,
                (DEFAULT_AUTO_GAMES, DEFAULT_MAX_STEPS, int(DEFAULT_SWAP), 0, created_at, created_at, now_iso()),
            )
            agents = conn.execute("SELECT * FROM agents ORDER BY created_at ASC, name ASC").fetchall()
            for seed, agent in enumerate(agents, start=1):
                conn.execute(
                    """
                    INSERT INTO tournament_agents(
                      tournament_id,agent_id,name,source,path,seed,elo,games,wins,losses,draws,
                      first_games,first_wins,second_games,second_wins
                    ) VALUES('legacy',?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        agent["id"], agent["name"], agent["source"], agent["path"], seed,
                        agent["elo"], agent["games"], agent["wins"], agent["losses"], agent["draws"],
                        agent["first_games"], agent["first_wins"], agent["second_games"], agent["second_wins"],
                    ),
                )
            conn.execute("UPDATE tournaments SET participant_count=? WHERE id='legacy'", (len(agents),))
        if legacy_exists or old_games or old_jobs:
            conn.execute("UPDATE jobs SET tournament_id='legacy' WHERE tournament_id IS NULL")
            conn.execute("UPDATE elo_games SET tournament_id='legacy' WHERE tournament_id IS NULL")
        conn.execute(
            "UPDATE jobs SET status='queued', error=COALESCE(error,'') || '\nrequeued after server restart', started_at=NULL WHERE status='running'"
        )


def slugify(value: str, fallback: str = "agent") -> str:
    s = secure_filename(value).strip("._-").lower()
    if not s:
        s = fallback
    return s[:40]


def next_agent_name(base_name: str) -> str:
    base = (base_name or "agent").strip() or "agent"
    version_re = re.compile(rf"^{re.escape(base)}(?: v(\d+))?$", re.IGNORECASE)
    with db() as conn:
        names = [str(r["name"]) for r in conn.execute("SELECT name FROM agents").fetchall()]
    versions = {int(match.group(1) or "1") for name in names if (match := version_re.match(name.strip()))}
    if not versions:
        return base
    version = 2
    while version in versions:
        version += 1
    return f"{base} v{version}"


def read_agent_meta(agent_dir: Path) -> dict[str, Any] | None:
    meta_path = agent_dir / ".agent_meta.json"
    if not meta_path.exists():
        return None
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return None


def valid_agent_dir(path: Path) -> bool:
    return path.is_dir() and (path / "main.py").exists() and (path / "deck.csv").exists()


def sync_agent_registry() -> None:
    """Register agents already present under agents/* so old workflows still work."""
    AGENTS_DIR.mkdir(parents=True, exist_ok=True)
    with db() as conn:
        for p in sorted(AGENTS_DIR.iterdir()):
            if not valid_agent_dir(p):
                continue
            meta = read_agent_meta(p) or {}
            agent_id = str(meta.get("id") or f"dir:{p.name}")
            name = str(meta.get("name") or p.name)
            source = str(meta.get("source") or "dir")
            created_at = str(meta.get("created_at") or now_iso())
            path = rel(p)
            existing = conn.execute("SELECT id FROM agents WHERE id=?", (agent_id,)).fetchone()
            if existing:
                conn.execute(
                    "UPDATE agents SET name=?, source=?, path=?, updated_at=? WHERE id=?",
                    (name, source, path, now_iso(), agent_id),
                )
            else:
                conn.execute(
                    "INSERT INTO agents(id,name,source,path,status,elo,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
                    (agent_id, name, source, path, "ready", ELO_INITIAL, created_at, now_iso()),
                )


def agent_rows(only_ready: bool = False, include_deleted: bool = False) -> list[dict[str, Any]]:
    sync_agent_registry()
    sql = "SELECT * FROM agents"
    filters: list[str] = []
    params: tuple[Any, ...] = ()
    if only_ready:
        filters.append("status='ready'")
    elif not include_deleted:
        filters.append("status!='deleted'")
    if filters:
        sql += " WHERE " + " AND ".join(filters)
    sql += " ORDER BY created_at DESC, name ASC"
    with db() as conn:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]


def get_agent(agent_id: str) -> dict[str, Any] | None:
    sync_agent_registry()
    with db() as conn:
        row = conn.execute("SELECT * FROM agents WHERE id=?", (agent_id,)).fetchone()
        return dict(row) if row else None


def resolve_agent_path(agent: dict[str, Any]) -> Path:
    p = Path(str(agent["path"]))
    return p if p.is_absolute() else ROOT / p


def job_rows(limit: int = 100) -> list[dict[str, Any]]:
    with db() as conn:
        return [
            dict(r)
            for r in conn.execute(
                """
                SELECT j.*, a0.name AS agent0_name, a1.name AS agent1_name, t.name AS tournament_name
                FROM jobs j
                JOIN agents a0 ON a0.id=j.agent0_id
                JOIN agents a1 ON a1.id=j.agent1_id
                LEFT JOIN tournaments t ON t.id=j.tournament_id
                ORDER BY j.created_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        ]


def get_job(job_id: str) -> dict[str, Any] | None:
    with db() as conn:
        row = conn.execute(
            """
            SELECT j.*, a0.name AS agent0_name, a1.name AS agent1_name, t.name AS tournament_name
            FROM jobs j
            JOIN agents a0 ON a0.id=j.agent0_id
            JOIN agents a1 ON a1.id=j.agent1_id
            LEFT JOIN tournaments t ON t.id=j.tournament_id
            WHERE j.id=?
            """,
            (job_id,),
        ).fetchone()
        return dict(row) if row else None


def normalize_job_type(job_type: str | None) -> tuple[str, int]:
    jt = (job_type or JOB_TYPE_AUTO).strip().lower()
    if jt in ("self-check", "sanity"):
        jt = JOB_TYPE_SELF_CHECK
    if jt not in JOB_PRIORITIES:
        jt = JOB_TYPE_AUTO
    return jt, JOB_PRIORITIES[jt]


def enqueue_job(
    agent0_id: str,
    agent1_id: str,
    games: int,
    max_steps: int,
    swap: bool,
    *,
    job_type: str = JOB_TYPE_AUTO,
    dedupe_running: bool = True,
    tournament_id: str | None = None,
) -> str | None:
    job_type, priority = normalize_job_type(job_type)
    if agent0_id == agent1_id and job_type != JOB_TYPE_SELF_CHECK:
        return None
    games = max(1, min(int(games), 10000))
    max_steps = max(10, int(max_steps))
    with db() as conn:
        a0 = conn.execute("SELECT id FROM agents WHERE id=? AND status='ready'", (agent0_id,)).fetchone()
        a1 = conn.execute("SELECT id FROM agents WHERE id=? AND status='ready'", (agent1_id,)).fetchone()
        if not a0 or not a1:
            return None
        if dedupe_running:
            found = conn.execute(
                """
                SELECT id FROM jobs
                WHERE status IN ('queued','running')
                  AND ((agent0_id=? AND agent1_id=?) OR (agent0_id=? AND agent1_id=?))
                ORDER BY priority ASC, created_at ASC
                LIMIT 1
                """,
                (agent0_id, agent1_id, agent1_id, agent0_id),
            ).fetchone()
            if found:
                return str(found["id"])
        job_id = f"job-{job_type}-" + datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
        conn.execute(
            """
            INSERT INTO jobs(id,agent0_id,agent1_id,games,max_steps,swap,job_type,priority,status,created_at,tournament_id)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)
            """,
            (job_id, agent0_id, agent1_id, games, max_steps, int(bool(swap)), job_type, priority, "queued", now_iso(), tournament_id),
        )
        return job_id

def enqueue_round_robin_for_agent(new_agent_id: str, games: int = DEFAULT_AUTO_GAMES, max_steps: int = DEFAULT_MAX_STEPS, swap: bool = DEFAULT_SWAP) -> list[str]:
    """Complete the round robin by pairing a new agent with every ready agent."""
    if not AUTO_MATCH_ENABLED:
        return []
    agents = [a for a in agent_rows(only_ready=True) if a["id"] != new_agent_id]
    job_ids: list[str] = []
    for opponent in agents:
        jid = enqueue_job(new_agent_id, opponent["id"], games, max_steps, swap, job_type=JOB_TYPE_AUTO, dedupe_running=True)
        if jid:
            job_ids.append(jid)
    return job_ids


def enqueue_round_robin(games: int = DEFAULT_AUTO_GAMES, max_steps: int = DEFAULT_MAX_STEPS, swap: bool = DEFAULT_SWAP, *, tournament_id: str | None = None) -> list[str]:
    """Queue exactly one matchup for every unordered pair of ready agents."""
    existing_pairs: set[frozenset[str]] = set()
    if tournament_id:
        with db() as conn:
            agents = [dict(row) for row in conn.execute("SELECT agent_id AS id FROM tournament_agents WHERE tournament_id=? ORDER BY seed", (tournament_id,)).fetchall()]
            existing_pairs = {
                frozenset((str(row["agent0_id"]), str(row["agent1_id"])))
                for row in conn.execute("SELECT agent0_id,agent1_id FROM jobs WHERE tournament_id=?", (tournament_id,)).fetchall()
            }
    else:
        agents = agent_rows(only_ready=True)
    job_ids: list[str] = []
    for index, agent0 in enumerate(agents):
        for agent1 in agents[index + 1:]:
            if frozenset((str(agent0["id"]), str(agent1["id"]))) in existing_pairs:
                continue
            job_id = enqueue_job(
                agent0["id"],
                agent1["id"],
                games,
                max_steps,
                swap,
                job_type=JOB_TYPE_AUTO,
                # A tournament owns a complete, isolated round robin. An open
                # round robin may reuse an already queued pairing.
                dedupe_running=tournament_id is None,
                tournament_id=tournament_id,
            )
            if job_id:
                job_ids.append(job_id)
    return job_ids


def enqueue_self_check(agent_id: str, games: int = DEFAULT_SELF_CHECK_GAMES, max_steps: int = DEFAULT_MAX_STEPS, swap: bool = True) -> str | None:
    """Queue a tiny same-agent smoke match for a freshly uploaded submission.

    The goal is to detect broken submissions before they pollute the round robin:
    import errors, invalid decks, illegal actions, max-step loops, and replay
    generation failures.  Elo is not updated for self-check games.
    """
    if not SELF_CHECK_ENABLED:
        return None
    return enqueue_job(
        agent_id,
        agent_id,
        max(1, int(games)),
        max_steps,
        swap,
        job_type=JOB_TYPE_SELF_CHECK,
        dedupe_running=True,
    )


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
                pass
    rows.sort(key=lambda r: str(r.get("started_at", "")), reverse=True)
    return rows


def find_run(run_id: str) -> dict[str, Any] | None:
    for r in iter_runs():
        if str(r.get("run_id", "")).startswith(run_id):
            return r
    return None


def replay_path(run: dict[str, Any]) -> Path:
    p = Path(str(run.get("replay", "")))
    return p if p.is_absolute() else ROOT / p


def read_replay_rows(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not path.exists():
        return rows
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def prune_tournament_replays(keep: int = TOURNAMENT_REPLAY_RETENTION) -> dict[str, int]:
    """Keep complete replay files for jobs in only the newest tournaments."""
    keep = max(0, int(keep))
    removed_files = 0
    removed_bytes = 0
    with db() as conn:
        kept_ids = {
            str(row["id"])
            for row in conn.execute("SELECT id FROM tournaments ORDER BY created_at DESC, id DESC LIMIT ?", (keep,)).fetchall()
        }
        stale = conn.execute(
            "SELECT id,replay_path,tournament_id FROM jobs WHERE replay_path IS NOT NULL AND tournament_id IS NOT NULL"
        ).fetchall()
        stale = [row for row in stale if str(row["tournament_id"]) not in kept_ids]
        for row in stale:
            path = Path(str(row["replay_path"]))
            path = path if path.is_absolute() else ROOT / path
            if path.is_file():
                removed_bytes += path.stat().st_size
                path.unlink()
                removed_files += 1
        if stale:
            conn.executemany("UPDATE jobs SET replay_path=NULL WHERE id=?", [(row["id"],) for row in stale])
    return {"removed_files": removed_files, "removed_bytes": removed_bytes, "kept_tournaments": len(kept_ids)}


def safe_extract_tar(tar_path: Path, dest: Path) -> None:
    dest = dest.resolve()
    with tarfile.open(tar_path, "r:*") as tf:
        for member in tf.getmembers():
            target = (dest / member.name).resolve()
            if not str(target).startswith(str(dest) + os.sep) and target != dest:
                raise ValueError(f"unsafe tar path: {member.name}")
            if member.issym() or member.islnk():
                raise ValueError(f"symlink/hardlink is not allowed in submission: {member.name}")
        tf.extractall(dest)


def locate_agent_root(extract_dir: Path) -> Path:
    candidates: list[Path] = []
    for main in extract_dir.rglob("main.py"):
        parent = main.parent
        if (parent / "deck.csv").exists():
            candidates.append(parent)
    if not candidates:
        raise ValueError("submission.tar.gz must contain main.py and deck.csv in the same directory")
    candidates.sort(key=lambda p: (len(p.relative_to(extract_dir).parts), str(p)))
    return candidates[0]


def validate_deck(agent_dir: Path) -> None:
    deck_path = agent_dir / "deck.csv"
    rows = [x.strip() for x in deck_path.read_text(encoding="utf-8").splitlines() if x.strip()]
    if len(rows) != 60:
        raise ValueError(f"deck.csv must contain exactly 60 lines, got {len(rows)}")
    for i, row in enumerate(rows, start=1):
        int(row)  # raises ValueError if invalid


def register_submission(upload_file, display_name: str | None = None) -> tuple[dict[str, Any], bool]:
    filename = secure_filename(upload_file.filename or "submission.tar.gz")
    if not (filename.endswith(".tar.gz") or filename.endswith(".tgz")):
        raise ValueError("submission.tar.gz または .tgz をアップロードしてください")
    data = upload_file.read()
    if not data:
        raise ValueError("empty upload")
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError(f"upload is too large. max={MAX_UPLOAD_BYTES // (1024*1024)}MB")

    import hashlib

    sha = hashlib.sha256(data).hexdigest()
    short = sha[:8]
    upload_dir = UPLOADS_DIR / sha
    upload_dir.mkdir(parents=True, exist_ok=True)
    archive_path = upload_dir / filename
    if not archive_path.exists():
        archive_path.write_bytes(data)

    base_name = display_name or filename.removesuffix(".tar.gz").removesuffix(".tgz")
    meta_name = next_agent_name(base_name)
    with db() as conn:
        sha_exists = conn.execute("SELECT 1 FROM agents WHERE id=?", (sha,)).fetchone() is not None
    agent_id = f"{sha[:16]}-{uuid.uuid4().hex[:8]}" if sha_exists else sha
    slug = slugify(meta_name, fallback="agent")
    target_dir = AGENTS_DIR / f"{slug}-{short}"
    if target_dir.exists():
        target_dir = AGENTS_DIR / f"{slug}-{short}-{uuid.uuid4().hex[:6]}"
    created = not target_dir.exists()

    if created:
        tmp_extract = upload_dir / "extract_tmp"
        if tmp_extract.exists():
            shutil.rmtree(tmp_extract)
        tmp_extract.mkdir(parents=True, exist_ok=True)
        safe_extract_tar(archive_path, tmp_extract)
        root = locate_agent_root(tmp_extract)
        validate_deck(root)
        shutil.copytree(root, target_dir)
        shutil.rmtree(tmp_extract, ignore_errors=True)
        meta = {
            "id": agent_id,
            "name": meta_name,
            "source": "upload",
            "sha256": sha,
            "original_filename": filename,
            "created_at": now_iso(),
        }
        (target_dir / ".agent_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        validate_deck(target_dir)

    with db() as conn:
        existing = conn.execute("SELECT * FROM agents WHERE id=?", (agent_id,)).fetchone()
        if existing:
            conn.execute(
                "UPDATE agents SET name=?, path=?, upload_path=?, original_filename=?, sha256=?, status='ready', error=NULL, updated_at=? WHERE id=?",
                (meta_name, rel(target_dir), rel(archive_path), filename, sha, now_iso(), agent_id),
            )
        else:
            conn.execute(
                """
                INSERT INTO agents(id,name,source,path,upload_path,original_filename,sha256,status,elo,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)
                """,
                (agent_id, meta_name, "upload", rel(target_dir), rel(archive_path), filename, sha, "ready", ELO_INITIAL, now_iso(), now_iso()),
            )
    return get_agent(agent_id) or {}, created


def summarize_replay(path: Path) -> tuple[str | None, dict[str, Any]]:
    rows = read_replay_rows(path)
    wins = {0: 0, 1: 0, 2: 0}
    run_id = None
    for row in rows:
        if run_id is None:
            run_id = row.get("run_id")
        winner = row.get("winner")
        if winner in (0, 1, 2):
            wins[int(winner)] += 1
        else:
            wins[2] += 1
    return str(run_id) if run_id else None, {"games": len(rows), "agent0_wins": wins[0], "agent1_wins": wins[1], "draws": wins[2]}



def replay_has_self_check_failure(path: Path) -> tuple[bool, str | None]:
    rows = read_replay_rows(path)
    if not rows:
        return False, "no replay rows generated"
    for i, row in enumerate(rows):
        reason = str(row.get("reason") or "")
        if row.get("error"):
            return False, f"game {i}: agent error: {row.get('error')}"
        if reason == "error" or reason.startswith("battle_start_error") or reason.startswith("max_steps_"):
            return False, f"game {i}: reason={reason}"
    return True, None


def mark_agent_failed(agent_id: str, error: str) -> int:
    """Mark an agent failed and cancel queued jobs that would use it. Returns canceled count."""
    with db() as conn:
        conn.execute(
            "UPDATE agents SET status='failed', error=?, updated_at=? WHERE id=?",
            (error[-4000:], now_iso(), agent_id),
        )
        cur = conn.execute(
            """
            UPDATE jobs
            SET status='failed', finished_at=?, error=COALESCE(error,'') || ?
            WHERE status='queued' AND (agent0_id=? OR agent1_id=?)
            """,
            (now_iso(), "\nCanceled because self-check failed.", agent_id, agent_id),
        )
        return int(cur.rowcount or 0)


def mark_agent_self_check_passed(agent_id: str) -> None:
    with db() as conn:
        conn.execute(
            "UPDATE agents SET status='ready', error=NULL, updated_at=? WHERE id=?",
            (now_iso(), agent_id),
        )


def pct(n: int | float, d: int | float) -> str:
    return "-" if not d else f"{(float(n) / float(d) * 100.0):.1f}%"


def expected_score(elo_a: float, elo_b: float) -> float:
    return 1.0 / (1.0 + 10.0 ** ((elo_b - elo_a) / 400.0))


def winner_to_score(winner: Any) -> tuple[float, float, str | None, bool]:
    if winner == 0:
        return 1.0, 0.0, "agent0", False
    if winner == 1:
        return 0.0, 1.0, "agent1", False
    return 0.5, 0.5, None, True


def update_agent_rating_stats(
    conn: sqlite3.Connection,
    agent_id: str,
    new_elo: float,
    score: float,
    *,
    was_first: bool | None,
) -> None:
    row = conn.execute(
        "SELECT games,wins,losses,draws,first_games,first_wins,second_games,second_wins FROM agents WHERE id=?",
        (agent_id,),
    ).fetchone()
    if not row:
        return
    games = int(row["games"] or 0) + 1
    wins = int(row["wins"] or 0) + (1 if score == 1.0 else 0)
    losses = int(row["losses"] or 0) + (1 if score == 0.0 else 0)
    draws = int(row["draws"] or 0) + (1 if score == 0.5 else 0)
    first_games = int(row["first_games"] or 0)
    first_wins = int(row["first_wins"] or 0)
    second_games = int(row["second_games"] or 0)
    second_wins = int(row["second_wins"] or 0)
    if was_first is True:
        first_games += 1
        first_wins += 1 if score == 1.0 else 0
    elif was_first is False:
        second_games += 1
        second_wins += 1 if score == 1.0 else 0
    conn.execute(
        """
        UPDATE agents
        SET elo=?, games=?, wins=?, losses=?, draws=?,
            first_games=?, first_wins=?, second_games=?, second_wins=?, updated_at=?
        WHERE id=?
        """,
        (new_elo, games, wins, losses, draws, first_games, first_wins, second_games, second_wins, now_iso(), agent_id),
    )


def update_tournament_rating_stats(
    conn: sqlite3.Connection,
    tournament_id: str,
    agent_id: str,
    new_elo: float,
    score: float,
    *,
    was_first: bool | None,
) -> None:
    row = conn.execute(
        """
        SELECT games,wins,losses,draws,first_games,first_wins,second_games,second_wins
        FROM tournament_agents WHERE tournament_id=? AND agent_id=?
        """,
        (tournament_id, agent_id),
    ).fetchone()
    if not row:
        return
    games = int(row["games"] or 0) + 1
    wins = int(row["wins"] or 0) + (1 if score == 1.0 else 0)
    losses = int(row["losses"] or 0) + (1 if score == 0.0 else 0)
    draws = int(row["draws"] or 0) + (1 if score == 0.5 else 0)
    first_games = int(row["first_games"] or 0)
    first_wins = int(row["first_wins"] or 0)
    second_games = int(row["second_games"] or 0)
    second_wins = int(row["second_wins"] or 0)
    if was_first is True:
        first_games += 1
        first_wins += 1 if score == 1.0 else 0
    elif was_first is False:
        second_games += 1
        second_wins += 1 if score == 1.0 else 0
    conn.execute(
        """
        UPDATE tournament_agents
        SET elo=?,games=?,wins=?,losses=?,draws=?,first_games=?,first_wins=?,second_games=?,second_wins=?
        WHERE tournament_id=? AND agent_id=?
        """,
        (new_elo, games, wins, losses, draws, first_games, first_wins, second_games, second_wins, tournament_id, agent_id),
    )


def rebuild_all_ratings(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        UPDATE agents
        SET elo=?, games=0, wins=0, losses=0, draws=0,
            first_games=0, first_wins=0, second_games=0, second_wins=0, updated_at=?
        """,
        (ELO_INITIAL, now_iso()),
    )
    rows = conn.execute("SELECT * FROM elo_games WHERE tournament_id IS NULL ORDER BY id ASC").fetchall()
    for row in rows:
        agent0_id = str(row["agent0_id"])
        agent1_id = str(row["agent1_id"])
        agent0 = conn.execute("SELECT elo FROM agents WHERE id=?", (agent0_id,)).fetchone()
        agent1 = conn.execute("SELECT elo FROM agents WHERE id=?", (agent1_id,)).fetchone()
        if not agent0 or not agent1:
            continue
        elo0_before = float(agent0["elo"] if agent0["elo"] is not None else ELO_INITIAL)
        elo1_before = float(agent1["elo"] if agent1["elo"] is not None else ELO_INITIAL)
        if row["draw"]:
            score0, score1 = 0.5, 0.5
        elif row["winner_agent_id"] == agent0_id:
            score0, score1 = 1.0, 0.0
        else:
            score0, score1 = 0.0, 1.0
        elo0_after = elo0_before + ELO_K * (score0 - expected_score(elo0_before, elo1_before))
        elo1_after = elo1_before + ELO_K * (score1 - expected_score(elo1_before, elo0_before))
        conn.execute(
            """
            UPDATE elo_games
            SET elo0_before=?, elo1_before=?, elo0_after=?, elo1_after=?
            WHERE id=?
            """,
            (elo0_before, elo1_before, elo0_after, elo1_after, row["id"]),
        )
        first_agent_id = row["first_agent_id"]
        update_agent_rating_stats(conn, agent0_id, elo0_after, score0, was_first=(first_agent_id == agent0_id) if first_agent_id else None)
        update_agent_rating_stats(conn, agent1_id, elo1_after, score1, was_first=(first_agent_id == agent1_id) if first_agent_id else None)


def remove_run_artifacts_for_agent(agent: dict[str, Any]) -> int:
    target = resolve_agent_path(agent).resolve()
    removed: list[dict[str, Any]] = []
    retained: list[dict[str, Any]] = []
    for run in iter_runs():
        paths = [Path(str(run.get(key) or "")).resolve() for key in ("agent0", "agent1")]
        (removed if target in paths else retained).append(run)

    if INDEX_PATH.exists():
        temporary = INDEX_PATH.with_suffix(".tmp")
        temporary.write_text("".join(json.dumps(run, ensure_ascii=False) + "\n" for run in retained), encoding="utf-8")
        temporary.replace(INDEX_PATH)
    for run in removed:
        run_id = str(run.get("run_id") or "")
        if run_id:
            (RUNS_DIR / f"{run_id}.json").unlink(missing_ok=True)
        replay_path(run).unlink(missing_ok=True)
    return len(removed)


def reset_all_history() -> None:
    for directory in (RUNS_DIR, JOBS_REPLAY_DIR):
        directory.mkdir(parents=True, exist_ok=True)
        for child in directory.iterdir():
            if child.name == ".gitkeep":
                continue
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink(missing_ok=True)
    with db() as conn:
        conn.execute("DELETE FROM elo_games")
        conn.execute("DELETE FROM jobs")
        conn.execute(
            """
            UPDATE agents
            SET elo=?, games=0, wins=0, losses=0, draws=0,
                first_games=0, first_wins=0, second_games=0, second_wins=0, updated_at=?
            """,
            (ELO_INITIAL, now_iso()),
        )


def apply_elo_from_replay(job: dict[str, Any], replay_file: Path) -> dict[str, Any]:
    rows = read_replay_rows(replay_file)
    if not rows:
        return {"applied_games": 0}
    agent0_id = str(job["agent0_id"])
    agent1_id = str(job["agent1_id"])
    if agent0_id == agent1_id or str(job.get("job_type") or "") == JOB_TYPE_SELF_CHECK:
        with db() as conn:
            conn.execute("UPDATE jobs SET elo_applied=1 WHERE id=?", (job["id"],))
        return {"applied_games": 0, "skipped_games": len(rows), "reason": "self_check_no_elo"}
    first_before: tuple[float, float] | None = None
    last_after: tuple[float, float] | None = None
    applied = 0
    skipped = 0
    run_id_out: str | None = None
    tournament_id = str(job.get("tournament_id") or "") or None
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        for row in rows:
            run_id = str(row.get("run_id") or job.get("run_id") or "")
            if not run_id:
                skipped += 1
                continue
            run_id_out = run_id_out or run_id
            game_index = int(row.get("game", applied + skipped))
            exists = conn.execute(
                "SELECT id FROM elo_games WHERE run_id=? AND game_index=?",
                (run_id, game_index),
            ).fetchone()
            if exists:
                skipped += 1
                continue
            if tournament_id:
                a0 = conn.execute("SELECT elo FROM tournament_agents WHERE tournament_id=? AND agent_id=?", (tournament_id, agent0_id)).fetchone()
                a1 = conn.execute("SELECT elo FROM tournament_agents WHERE tournament_id=? AND agent_id=?", (tournament_id, agent1_id)).fetchone()
            else:
                a0 = conn.execute("SELECT elo FROM agents WHERE id=?", (agent0_id,)).fetchone()
                a1 = conn.execute("SELECT elo FROM agents WHERE id=?", (agent1_id,)).fetchone()
            if not a0 or not a1:
                skipped += 1
                continue
            elo0_before = float(a0["elo"] if a0["elo"] is not None else ELO_INITIAL)
            elo1_before = float(a1["elo"] if a1["elo"] is not None else ELO_INITIAL)
            if first_before is None:
                first_before = (elo0_before, elo1_before)
            score0, score1, winner_side, is_draw = winner_to_score(row.get("winner"))
            exp0 = expected_score(elo0_before, elo1_before)
            exp1 = 1.0 - exp0
            elo0_after = elo0_before + ELO_K * (score0 - exp0)
            elo1_after = elo1_before + ELO_K * (score1 - exp1)
            first_player = row.get("first_player")
            first_agent_id: str | None = None
            second_agent_id: str | None = None
            if first_player == 0:
                first_agent_id, second_agent_id = agent0_id, agent1_id
            elif first_player == 1:
                first_agent_id, second_agent_id = agent1_id, agent0_id
            winner_agent_id = agent0_id if winner_side == "agent0" else agent1_id if winner_side == "agent1" else None
            conn.execute(
                """
                INSERT INTO elo_games(
                  job_id,run_id,game_index,agent0_id,agent1_id,winner_agent_id,draw,
                  first_agent_id,second_agent_id,steps,reason,
                  elo0_before,elo1_before,elo0_after,elo1_after,created_at,tournament_id
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    job["id"], run_id, game_index, agent0_id, agent1_id, winner_agent_id, int(is_draw),
                    first_agent_id, second_agent_id, row.get("steps"), str(row.get("reason")),
                    elo0_before, elo1_before, elo0_after, elo1_after, now_iso(), tournament_id,
                ),
            )
            if tournament_id:
                update_tournament_rating_stats(conn, tournament_id, agent0_id, elo0_after, score0, was_first=(first_agent_id == agent0_id) if first_agent_id else None)
                update_tournament_rating_stats(conn, tournament_id, agent1_id, elo1_after, score1, was_first=(first_agent_id == agent1_id) if first_agent_id else None)
            else:
                update_agent_rating_stats(conn, agent0_id, elo0_after, score0, was_first=(first_agent_id == agent0_id) if first_agent_id else None)
                update_agent_rating_stats(conn, agent1_id, elo1_after, score1, was_first=(first_agent_id == agent1_id) if first_agent_id else None)
            applied += 1
            last_after = (elo0_after, elo1_after)
        conn.execute("UPDATE jobs SET elo_applied=1 WHERE id=?", (job["id"],))
    return {
        "run_id": run_id_out,
        "applied_games": applied,
        "skipped_games": skipped,
        "agent0_elo_before": first_before[0] if first_before else None,
        "agent1_elo_before": first_before[1] if first_before else None,
        "agent0_elo_after": last_after[0] if last_after else None,
        "agent1_elo_after": last_after[1] if last_after else None,
        "agent0_delta": (last_after[0] - first_before[0]) if first_before and last_after else 0.0,
        "agent1_delta": (last_after[1] - first_before[1]) if first_before and last_after else 0.0,
    }


def rating_games_for_run(run_id: str) -> dict[int, dict[str, Any]]:
    with db() as conn:
        rows = conn.execute("SELECT * FROM elo_games WHERE run_id=? ORDER BY game_index ASC", (run_id,)).fetchall()
        return {int(r["game_index"]): dict(r) for r in rows}


def last_record(agent_id: str, limit: int = 20, tournament_id: str | None = None) -> str:
    with db() as conn:
        sql = """
            SELECT winner_agent_id, draw FROM elo_games
            WHERE agent0_id=? OR agent1_id=?
        """
        params: list[Any] = [agent_id, agent_id]
        if tournament_id:
            sql = sql.replace("WHERE agent0_id=? OR agent1_id=?", "WHERE (agent0_id=? OR agent1_id=?) AND tournament_id=?")
            params.append(tournament_id)
        else:
            sql = sql.replace("WHERE agent0_id=? OR agent1_id=?", "WHERE (agent0_id=? OR agent1_id=?) AND tournament_id IS NULL")
        sql += " ORDER BY id DESC LIMIT ?"
        params.append(limit)
        rows = conn.execute(sql, params).fetchall()
    if not rows:
        return "-"
    wins = sum(1 for r in rows if not r["draw"] and r["winner_agent_id"] == agent_id)
    draws = sum(1 for r in rows if r["draw"])
    losses = len(rows) - wins - draws
    return f"{wins}-{losses}-{draws}"


def ranking_rows() -> list[dict[str, Any]]:
    sync_agent_registry()
    with db() as conn:
        return [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM agents WHERE status='ready' ORDER BY elo DESC, games DESC, name ASC"
            ).fetchall()
        ]


def tournament_rows() -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute("SELECT * FROM tournaments ORDER BY created_at DESC").fetchall()
        output: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            counts = conn.execute(
                """
                SELECT COUNT(*) AS jobs,
                       SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued,
                       SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) AS running,
                       SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done,
                       SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
                FROM jobs WHERE tournament_id=?
                """,
                (item["id"],),
            ).fetchone()
            item.update({key: int(counts[key] or 0) for key in ("jobs", "queued", "running", "done", "failed")})
            if item["status"] == "running" and item["jobs"] and not item["queued"] and not item["running"]:
                item["status"] = "completed"
                item["completed_at"] = item.get("completed_at") or now_iso()
                conn.execute("UPDATE tournaments SET status='completed', completed_at=? WHERE id=?", (item["completed_at"], item["id"]))
            output.append(item)
        return output


def latest_tournament() -> dict[str, Any] | None:
    rows = tournament_rows()
    return rows[0] if rows else None


def tournament_ranking_rows(tournament_id: str) -> list[dict[str, Any]]:
    with db() as conn:
        return [
            dict(row)
            for row in conn.execute(
                """
                SELECT agent_id AS id, substr(agent_id,1,16) AS short_id, name, source, path,
                       elo,games,wins,losses,draws,first_games,first_wins,second_games,second_wins
                FROM tournament_agents
                WHERE tournament_id=?
                ORDER BY elo DESC, games DESC, seed ASC
                """,
                (tournament_id,),
            ).fetchall()
        ]


def api_tournament_agent_row(agent: dict[str, Any], tournament_id: str) -> dict[str, Any]:
    out = dict(agent)
    out["status"] = "snapshot"
    out["elo"] = float(out.get("elo") or ELO_INITIAL)
    for key in ("games", "wins", "losses", "draws", "first_games", "first_wins", "second_games", "second_wins"):
        out[key] = int(out.get(key) or 0)
    out["last_record"] = last_record(str(out["id"]), tournament_id=tournament_id)
    return out


def create_and_start_tournament(name: str, games: int, max_steps: int = DEFAULT_MAX_STEPS, swap: bool = True) -> tuple[dict[str, Any], list[str]]:
    agents = agent_rows(only_ready=True)
    if len(agents) < 2:
        raise ValueError("大会にはready状態のAgentが2件以上必要です。")
    tournament_id = "tournament-" + datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    started_at = now_iso()
    display_name = name.strip() or datetime.now().strftime("総当たり大会 %Y-%m-%d %H:%M")
    with db() as conn:
        conn.execute(
            """
            INSERT INTO tournaments(id,name,status,games_per_match,max_steps,swap,participant_count,created_at,started_at)
            VALUES(?,?, 'running', ?, ?, ?, ?, ?, ?)
            """,
            (tournament_id, display_name, games, max_steps, int(swap), len(agents), started_at, started_at),
        )
        for seed, agent in enumerate(agents, start=1):
            conn.execute(
                """
                INSERT INTO tournament_agents(tournament_id,agent_id,name,source,path,seed,elo)
                VALUES(?,?,?,?,?,?,?)
                """,
                (tournament_id, agent["id"], agent["name"], agent.get("source"), agent.get("path"), seed, ELO_INITIAL),
            )
    job_ids = enqueue_round_robin(games=games, max_steps=max_steps, swap=swap, tournament_id=tournament_id)
    return next(row for row in tournament_rows() if row["id"] == tournament_id), job_ids


def remove_run_artifacts_by_ids(run_ids: set[str]) -> None:
    if not run_ids:
        return
    retained: list[dict[str, Any]] = []
    for run in iter_runs():
        if str(run.get("run_id") or "") in run_ids:
            replay_path(run).unlink(missing_ok=True)
            (RUNS_DIR / f"{run.get('run_id')}.json").unlink(missing_ok=True)
        else:
            retained.append(run)
    if INDEX_PATH.exists():
        temporary = INDEX_PATH.with_suffix(".tmp")
        temporary.write_text("".join(json.dumps(run, ensure_ascii=False) + "\n" for run in retained), encoding="utf-8")
        temporary.replace(INDEX_PATH)


def reset_and_restart_tournament(tournament_id: str) -> list[str]:
    with db() as conn:
        tournament = conn.execute("SELECT * FROM tournaments WHERE id=?", (tournament_id,)).fetchone()
        if not tournament:
            raise ValueError("大会が見つかりません。")
        latest = conn.execute("SELECT id FROM tournaments ORDER BY created_at DESC LIMIT 1").fetchone()
        if not latest or latest["id"] != tournament_id:
            raise ValueError("リセットできるのは最新の大会だけです。")
        jobs = conn.execute("SELECT run_id,replay_path FROM jobs WHERE tournament_id=?", (tournament_id,)).fetchall()
        run_ids = {str(row["run_id"]) for row in jobs if row["run_id"]}
        replay_files = [ROOT / str(row["replay_path"]) for row in jobs if row["replay_path"]]
    remove_run_artifacts_by_ids(run_ids)
    for replay_file in replay_files:
        replay_file.unlink(missing_ok=True)
    with db() as conn:
        conn.execute("DELETE FROM elo_games WHERE tournament_id=?", (tournament_id,))
        conn.execute("DELETE FROM jobs WHERE tournament_id=?", (tournament_id,))
        conn.execute(
            """
            UPDATE tournament_agents SET elo=?,games=0,wins=0,losses=0,draws=0,
                first_games=0,first_wins=0,second_games=0,second_wins=0 WHERE tournament_id=?
            """,
            (ELO_INITIAL, tournament_id),
        )
        conn.execute("UPDATE tournaments SET status='running',started_at=?,completed_at=NULL WHERE id=?", (now_iso(), tournament_id))
        games = int(tournament["games_per_match"])
        max_steps = int(tournament["max_steps"])
        swap = bool(tournament["swap"])
    return enqueue_round_robin(games=games, max_steps=max_steps, swap=swap, tournament_id=tournament_id)


def claim_job() -> dict[str, Any] | None:
    conn = db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY priority ASC, created_at ASC LIMIT 1").fetchone()
        if not row:
            conn.commit()
            return None
        conn.execute("UPDATE jobs SET status='running', started_at=?, error=NULL WHERE id=?", (now_iso(), row["id"]))
        conn.commit()
        return dict(row)
    finally:
        conn.close()


def update_job(job_id: str, **fields: Any) -> None:
    if not fields:
        return
    keys = list(fields)
    sql = "UPDATE jobs SET " + ", ".join(f"{k}=?" for k in keys) + " WHERE id=?"
    values = [fields[k] for k in keys] + [job_id]
    with db() as conn:
        conn.execute(sql, values)


def run_job(job: dict[str, Any]) -> None:
    a0 = get_agent(job["agent0_id"])
    a1 = get_agent(job["agent1_id"])
    if not a0 or not a1:
        update_job(job["id"], status="failed", finished_at=now_iso(), error="agent not found")
        return
    job_type = normalize_job_type(str(job.get("job_type") or JOB_TYPE_AUTO))[0]
    if job_type != JOB_TYPE_SELF_CHECK and (a0.get("status") != "ready" or a1.get("status") != "ready"):
        update_job(job["id"], status="failed", finished_at=now_iso(), error="agent is not ready")
        return

    replay_rel = f"replays/jobs/{job['id']}.jsonl"
    cmd = [
        sys.executable,
        "tools/friend_battle.py",
        "--agent0",
        rel(resolve_agent_path(a0)),
        "--agent1",
        rel(resolve_agent_path(a1)),
        "--games",
        str(job["games"]),
        "--max-steps",
        str(job["max_steps"]),
        "--out",
        replay_rel,
    ]
    if int(job.get("swap", 1)):
        cmd.append("--swap")

    timeout = max(120, int(job["games"]) * 40)
    replay_abs = ROOT / replay_rel
    try:
        proc = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True, timeout=timeout)
        if proc.returncode != 0:
            error_msg = f"friend_battle.py exited with {proc.returncode}"
            if job_type == JOB_TYPE_SELF_CHECK:
                canceled = mark_agent_failed(str(job["agent0_id"]), error_msg)
                error_msg += f"; agent disabled; canceled queued jobs={canceled}"
            update_job(
                job["id"],
                status="failed",
                finished_at=now_iso(),
                stdout=proc.stdout[-8000:],
                stderr=proc.stderr[-8000:],
                replay_path=replay_rel if replay_abs.exists() else None,
                error=error_msg,
            )
            return
        run_id, summary = summarize_replay(replay_abs)
        if job_type == JOB_TYPE_SELF_CHECK:
            passed, self_error = replay_has_self_check_failure(replay_abs)
            summary["self_check"] = "passed" if passed else "failed"
            if passed:
                mark_agent_self_check_passed(str(job["agent0_id"]))
            else:
                canceled = mark_agent_failed(str(job["agent0_id"]), self_error or "self-check failed")
                summary["self_check_error"] = self_error
                summary["canceled_jobs"] = canceled
                update_job(
                    job["id"],
                    status="failed",
                    finished_at=now_iso(),
                    replay_path=replay_rel,
                    run_id=run_id,
                    result_json=json.dumps(summary, ensure_ascii=False),
                    stdout=proc.stdout[-8000:],
                    stderr=proc.stderr[-8000:],
                    error=f"self-check failed: {self_error}; canceled queued jobs={canceled}",
                )
                return
        try:
            elo_summary = apply_elo_from_replay({**job, "run_id": run_id}, replay_abs)
            summary["elo"] = elo_summary
        except Exception as elo_exc:
            summary["elo_error"] = repr(elo_exc)
        update_job(
            job["id"],
            status="done",
            finished_at=now_iso(),
            replay_path=replay_rel,
            run_id=run_id,
            result_json=json.dumps(summary, ensure_ascii=False),
            stdout=proc.stdout[-8000:],
            stderr=proc.stderr[-8000:],
            error=None,
        )
    except subprocess.TimeoutExpired as exc:
        error_msg = f"timeout after {timeout}s"
        if job_type == JOB_TYPE_SELF_CHECK:
            canceled = mark_agent_failed(str(job["agent0_id"]), error_msg)
            error_msg += f"; agent disabled; canceled queued jobs={canceled}"
        update_job(
            job["id"],
            status="failed",
            finished_at=now_iso(),
            stdout=(exc.stdout or "")[-8000:] if isinstance(exc.stdout, str) else "",
            stderr=(exc.stderr or "")[-8000:] if isinstance(exc.stderr, str) else "",
            replay_path=replay_rel if (ROOT / replay_rel).exists() else None,
            error=error_msg,
        )
    except Exception as exc:
        update_job(job["id"], status="failed", finished_at=now_iso(), error=repr(exc) + "\n" + traceback.format_exc(limit=8))
    finally:
        try:
            prune_tournament_replays()
        except (OSError, sqlite3.Error):
            app.logger.exception("failed to prune old tournament replays")


_worker_started = False
_worker_stop = threading.Event()


def worker_loop() -> None:
    while not _worker_stop.is_set():
        try:
            with _battle_operation_lock:
                job = claim_job()
                if job:
                    run_job(job)
                    continue
        except Exception:
            # Keep the local toy worker alive even if one DB operation fails.
            traceback.print_exc()
        _worker_stop.wait(WORKER_POLL_SECONDS)


def start_worker_once() -> None:
    global _worker_started
    if _worker_started or not WORKER_ENABLED:
        return
    _worker_started = True
    t = threading.Thread(target=worker_loop, name="friend-battle-worker", daemon=True)
    t.start()


def upload_form_html(opts: str, *, compact: bool = False) -> str:
    return f"""
      <form method='post' action='{url_for('upload_agent')}' enctype='multipart/form-data'>
        <div class='row'>
          <div><label>Agent名</label><input name='name' placeholder='friend-lucario-v1'></div>
          <div><label>submission.tar.gz / .tgz</label><input type='file' name='submission' accept='.gz,.tgz,application/gzip' required></div>
        </div>
        <div class='card' style='box-shadow:none;background:#fafafa'>
          <h3>Battle Now</h3>
          <p class='muted'>最優先ジョブとして投入します。すでに別ジョブが実行中なら、その次に実行されます。</p>
          <p><label><input type='checkbox' name='battle_now' checked style='width:auto'> アップロード後すぐに対戦する</label></p>
          <div class='row compact'>
            <div><label>Opponent</label><select name='now_opponent'><option value=''>登録だけする</option>{opts}</select></div>
            <div><label>Games</label><input name='now_games' type='number' value='{DEFAULT_IMMEDIATE_GAMES}' min='1' max='10000'></div>
            <div><label>Max steps</label><input name='max_steps' type='number' value='{DEFAULT_MAX_STEPS}' min='10'></div>
          </div>
          <p><label><input type='checkbox' name='now_swap' checked style='width:auto'> 先後入れ替えあり</label></p>
        </div>
        <div class='card' style='box-shadow:none;background:#fafafa'>
          <h3>Self Check</h3>
          <p class='muted'>アップロードされたAgentを同じAgent同士で{DEFAULT_SELF_CHECK_GAMES}戦だけ回して、起動・合法手・replay生成を確認します。失敗するとAgentをfailedにして総当たり戦のqueued jobを止めます。</p>
        </div>
        <div class='card' style='box-shadow:none;background:#fafafa'>
          <h3>自動チェック</h3>
          <p class='muted'>追加時はSelf Checkのみ実行します。正式な比較対戦は大会管理から開始してください。</p>
        </div>
        <button>アップロード</button>
      </form>
    """


@app.get("/")
def index():
    agents_list = agent_rows(only_ready=True)
    jobs_list = job_rows(limit=8)
    runs_list = iter_runs()[:5]
    queued = sum(1 for j in jobs_list if j["status"] == "queued")
    running = sum(1 for j in jobs_list if j["status"] == "running")
    done = sum(1 for j in jobs_list if j["status"] == "done")
    failed = sum(1 for j in jobs_list if j["status"] == "failed")
    opts = "".join(f"<option value='{esc(a['id'])}'>{esc(a['name'])}</option>" for a in agents_list)
    job_rows_html = "".join(render_job_tr(j) for j in jobs_list)
    run_rows_html = "".join(render_run_tr(r) for r in runs_list)
    top_rank_rows = ranking_rows()[:5]
    top_rank_html = "".join(
        f"<tr><td>{i}</td><td>{esc(a['name'])}</td><td><b>{float(a.get('elo') or ELO_INITIAL):.1f}</b></td><td>{int(a.get('games') or 0)}</td><td>{pct(int(a.get('wins') or 0), int(a.get('games') or 0))}</td><td>{last_record(a['id'])}</td></tr>"
        for i, a in enumerate(top_rank_rows, start=1)
    )
    body = f"""
    <div class='grid'>
      <div class='card'><div class='muted'>Agents</div><div class='metric'>{len(agents_list)}</div></div>
      <div class='card'><div class='muted'>Queued / Running</div><div class='metric'>{queued} / {running}</div></div>
      <div class='card'><div class='muted'>Done / Failed</div><div class='metric'>{done} / {failed}</div></div>
      <div class='card'><div class='muted'>自動総当たり</div><div class='metric'>{'ON' if AUTO_MATCH_ENABLED else 'OFF'}</div><div class='small muted'>upload後、ready状態の全Agentと各{DEFAULT_AUTO_GAMES}ゲーム</div><div class='small muted'>self-check: {'ON' if SELF_CHECK_ENABLED else 'OFF'} / uploaded agent vs itself, {DEFAULT_SELF_CHECK_GAMES} games</div></div>
    </div>

    <div class='card'><h2>Top Ranking</h2><table><tr><th>#</th><th>Agent</th><th>Elo</th><th>Games</th><th>Win%</th><th>Last20</th></tr>{top_rank_html}</table><p><a href='{url_for('ranking')}'>ランキングをすべて見る</a></p></div>

    <div class='card'>
      <h2>submission.tar.gz をアップロード</h2>
      <p class='muted'>Self Check後、既存のready状態の全Agentとの総当たり対戦を投入します。</p>
      {upload_form_html(opts)}
    </div>

    <div class='card'>
      <h2>手動でジョブ投入</h2>
      <form method='post' action='{url_for('enqueue_battle')}'>
        <div class='row compact'>
          <div><label>Agent A</label><select name='agent0'>{opts}</select></div>
          <div><label>Agent B</label><select name='agent1'>{opts}</select></div>
          <div><label>Games</label><input name='games' type='number' value='{DEFAULT_AUTO_GAMES}' min='1' max='10000'></div>
          <div><label>Max steps</label><input name='max_steps' type='number' value='{DEFAULT_MAX_STEPS}' min='10'></div>
          <div><label>Job type</label><select name='job_type'><option value='immediate'>Immediate / 今すぐ</option><option value='self_check'>Self Check</option><option value='manual' selected>Manual</option><option value='auto'>Auto</option></select></div>
        </div>
        <p><label><input type='checkbox' name='swap' checked style='width:auto'> 先後入れ替えあり</label></p>
        <button>Queueに入れる</button>
      </form>
    </div>

    <div class='card'><h2>Recent Jobs</h2><table><tr><th>job</th><th>type</th><th>status</th><th>matchup</th><th>games</th><th>result</th><th>created</th><th>link</th></tr>{job_rows_html}</table><p><a href='{url_for('jobs')}'>すべて見る</a></p></div>
    <div class='card'><h2>Recent Runs</h2><table><tr><th>run</th><th>date</th><th>matchup</th><th>games</th><th>W-L-D</th><th>agent0 win%</th><th>replay</th></tr>{run_rows_html}</table></div>
    """
    return render_template_string(page("Friend Battle", body, refresh_seconds=10 if running or queued else None))


@app.post("/api/agents/upload")
@app.post("/agents/upload")
def upload_agent():
    f = request.files.get("submission")
    name = (request.form.get("name") or "").strip() or None
    if not f:
        if wants_json():
            return jsonify({"ok": False, "error": "submission.tar.gz を選択してください。"}), 400
        flash("submission.tar.gz を選択してください。")
        return redirect(url_for("agents"))
    try:
        agent, created = register_submission(f, name)
        immediate_job_id: str | None = None
        self_check_job_id: str | None = None

        max_steps = int(request.form.get("max_steps", str(DEFAULT_MAX_STEPS)))
        if request.form.get("battle_now") is not None:
            opponent_id = (request.form.get("now_opponent") or "").strip()
            now_games = int(request.form.get("now_games", str(DEFAULT_IMMEDIATE_GAMES)))
            now_swap = request.form.get("now_swap") is not None
            if opponent_id and opponent_id != agent["id"]:
                immediate_job_id = enqueue_job(
                    agent["id"],
                    opponent_id,
                    now_games,
                    max_steps,
                    now_swap,
                    job_type=JOB_TYPE_IMMEDIATE,
                    dedupe_running=False,
                )

        self_check_job_id = enqueue_self_check(agent["id"], max_steps=max_steps)

        status = "登録" if created else "更新"
        message = f"Agent{status}: {agent['name']} / self-check: {1 if self_check_job_id else 0} 件"
        if wants_json():
            detail_job = immediate_job_id or self_check_job_id
            return jsonify({
                "ok": True,
                "message": message,
                "agent": api_agent_row(agent, include_checks=True),
                "created": created,
                "immediate_job_id": immediate_job_id,
                "self_check_job_id": self_check_job_id,
                "auto_job_ids": [],
                "redirect": f"/jobs/{detail_job}" if detail_job else "/agents",
            })
        flash(message)
        if immediate_job_id:
            return redirect(url_for("job_detail", job_id=immediate_job_id))
        if self_check_job_id:
            return redirect(url_for("job_detail", job_id=self_check_job_id))
        return redirect(url_for("agents"))
    except Exception as exc:
        if wants_json():
            return jsonify({"ok": False, "error": f"アップロード失敗: {exc}"}), 400
        flash(f"アップロード失敗: {exc}")
        return redirect(url_for("agents"))

@app.post("/api/jobs/enqueue")
@app.post("/jobs/enqueue")
def enqueue_battle():
    agent0 = request.form.get("agent0", "")
    agent1 = request.form.get("agent1", "")
    games = int(request.form.get("games", str(DEFAULT_AUTO_GAMES)))
    max_steps = int(request.form.get("max_steps", str(DEFAULT_MAX_STEPS)))
    swap = request.form.get("swap") is not None
    job_type = request.form.get("job_type", JOB_TYPE_MANUAL)
    jid = enqueue_job(agent0, agent1, games, max_steps, swap, job_type=job_type, dedupe_running=False)
    if jid:
        if wants_json():
            return jsonify({"ok": True, "message": f"ジョブを投入しました: {jid}", "job_id": jid, "redirect": f"/jobs/{jid}"})
        flash(f"ジョブを投入しました: {jid}")
        return redirect(url_for("job_detail", job_id=jid))
    if wants_json():
        return jsonify({"ok": False, "error": "ジョブ投入に失敗しました。Agentが同一、または未登録です。"}), 400
    flash("ジョブ投入に失敗しました。Agentが同一、または未登録です。")
    return redirect(url_for("index"))


@app.post("/api/jobs/<job_id>/retry")
@app.post("/jobs/<job_id>/retry")
def retry_job(job_id: str):
    job = get_job(job_id)
    if not job:
        if wants_json():
            return jsonify({"ok": False, "error": "job not found"}), 404
        return Response("job not found", status=404)
    if job["status"] == "running":
        if wants_json():
            return jsonify({"ok": False, "error": "running中のjobはretryできません。"}), 400
        flash("running中のjobはretryできません。")
        return redirect(url_for("job_detail", job_id=job_id))
    with db() as conn:
        conn.execute(
            "UPDATE jobs SET status='queued', started_at=NULL, finished_at=NULL, error=NULL, stdout=NULL, stderr=NULL, elo_applied=0 WHERE id=?",
            (job_id,),
        )
    if wants_json():
        return jsonify({"ok": True, "message": "retryとしてqueueに戻しました。"})
    flash("retryとしてqueueに戻しました。")
    return redirect(url_for("jobs"))


@app.post("/api/league/enqueue")
def api_enqueue_full_league():
    payload = request.get_json(silent=True) or {}
    games = max(1, min(int(payload.get("games", DEFAULT_AUTO_GAMES)), 1000))
    job_ids = enqueue_round_robin(games=games, max_steps=DEFAULT_MAX_STEPS, swap=True)
    agent_count = len(agent_rows(only_ready=True))
    return jsonify({
        "ok": True,
        "message": f"総当たり戦を投入しました: {len(job_ids)}組 / 1組あたり{games}ゲーム",
        "agents": agent_count,
        "jobs": len(job_ids),
        "job_ids": job_ids,
    })


@app.get("/api/tournaments")
def api_tournaments():
    rows = tournament_rows()
    return jsonify({"tournaments": rows, "current": rows[0] if rows else None})


@app.post("/api/tournaments")
def api_create_tournament():
    payload = request.get_json(silent=True) or {}
    try:
        games = max(1, min(int(payload.get("games", DEFAULT_AUTO_GAMES)), 1000))
        max_steps = max(10, min(int(payload.get("max_steps", DEFAULT_MAX_STEPS)), 100000))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "games must be a number"}), 400
    try:
        tournament, job_ids = create_and_start_tournament(str(payload.get("name") or ""), games, max_steps, bool(payload.get("swap", True)))
        prune_tournament_replays()
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    return jsonify({"ok": True, "message": f"{tournament['name']} を開始しました。", "tournament": tournament, "jobs": len(job_ids)})


@app.post("/api/tournaments/<tournament_id>/reset-and-restart")
def api_reset_tournament(tournament_id: str):
    payload = request.get_json(silent=True) or {}
    if payload.get("confirm") is not True:
        return jsonify({"ok": False, "error": "confirm=true is required"}), 400
    if not _battle_operation_lock.acquire(blocking=False):
        return jsonify({"ok": False, "error": "試合を実行中です。完了後にリセットしてください。"}), 409
    try:
        with db() as conn:
            active = conn.execute("SELECT COUNT(*) FROM jobs WHERE tournament_id=? AND status IN ('queued','running')", (tournament_id,)).fetchone()[0]
        if active:
            return jsonify({"ok": False, "error": "この大会には未完了のJobsがあります。完了後にリセットしてください。"}), 409
        job_ids = reset_and_restart_tournament(tournament_id)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    finally:
        _battle_operation_lock.release()
    return jsonify({"ok": True, "message": "大会ランキングをリセットして再開しました。", "jobs": len(job_ids)})


@app.post("/api/league/reset-and-enqueue")
def api_reset_and_enqueue_full_league():
    payload = request.get_json(silent=True) or {}
    if payload.get("confirm") is not True:
        return jsonify({"ok": False, "error": "confirm=true is required"}), 400
    games = max(1, min(int(payload.get("games", DEFAULT_AUTO_GAMES)), 1000))
    if not _battle_operation_lock.acquire(blocking=False):
        return jsonify({"ok": False, "error": "試合を実行中です。完了後にもう一度実行してください。"}), 409
    try:
        reset_all_history()
        job_ids = enqueue_round_robin(games=games, max_steps=DEFAULT_MAX_STEPS, swap=True)
    finally:
        _battle_operation_lock.release()
    return jsonify({
        "ok": True,
        "message": f"履歴をリセットし、総当たり戦を投入しました: {len(job_ids)}組 / 1組あたり{games}ゲーム",
        "agents": len(agent_rows(only_ready=True)),
        "jobs": len(job_ids),
        "job_ids": job_ids,
    })


@app.get("/api/config")
def api_config():
    return jsonify({
        "defaults": {
            "auto_games": DEFAULT_AUTO_GAMES,
            "immediate_games": DEFAULT_IMMEDIATE_GAMES,
            "self_check_games": DEFAULT_SELF_CHECK_GAMES,
            "auto_opponents": DEFAULT_AUTO_OPPONENTS,
            "max_steps": DEFAULT_MAX_STEPS,
            "swap": DEFAULT_SWAP,
        },
        "features": {
            "auto_match": AUTO_MATCH_ENABLED,
            "self_check": SELF_CHECK_ENABLED,
            "worker": WORKER_ENABLED,
        },
        "elo": {"initial": ELO_INITIAL, "k": ELO_K},
    })


@app.get("/api/dashboard")
def api_dashboard():
    current_tournament = latest_tournament()
    tournament_rank = tournament_ranking_rows(current_tournament["id"]) if current_tournament else []
    tournament_by_id = {str(row["id"]): row for row in tournament_rank}
    agents_ready = []
    for agent in agent_rows(only_ready=True):
        item = api_agent_row(agent)
        snapshot = tournament_by_id.get(str(agent["id"]))
        if snapshot:
            tournament_item = api_tournament_agent_row(snapshot, current_tournament["id"])
            for key in ("elo", "games", "wins", "losses", "draws", "first_games", "first_wins", "second_games", "second_wins", "last_record"):
                item[key] = tournament_item[key]
        agents_ready.append(item)
    jobs_list = [api_job_row(j) for j in job_rows(limit=8)]
    runs_list = [api_run_row(r) for r in iter_runs()[:5]]
    top_rank = [api_tournament_agent_row(a, current_tournament["id"]) for a in tournament_rank[:5]] if current_tournament else [api_agent_row(a) for a in ranking_rows()[:5]]
    return jsonify({
        "metrics": {
            "agents": len(agents_ready),
            "queued": sum(1 for j in jobs_list if j["status"] == "queued"),
            "running": sum(1 for j in jobs_list if j["status"] == "running"),
            "done": sum(1 for j in jobs_list if j["status"] == "done"),
            "failed": sum(1 for j in jobs_list if j["status"] == "failed"),
            "auto_match": AUTO_MATCH_ENABLED,
            "self_check": SELF_CHECK_ENABLED,
        },
        "defaults": {
            "auto_games": DEFAULT_AUTO_GAMES,
            "immediate_games": DEFAULT_IMMEDIATE_GAMES,
            "self_check_games": DEFAULT_SELF_CHECK_GAMES,
            "auto_opponents": DEFAULT_AUTO_OPPONENTS,
            "max_steps": DEFAULT_MAX_STEPS,
        },
        "agents": agents_ready,
        "jobs": jobs_list,
        "runs": runs_list,
        "ranking": top_rank,
        "tournament": current_tournament,
    })


@app.get("/api/agents")
def api_agents():
    rows = [api_agent_row(a, include_checks=True) for a in agent_rows(only_ready=False)]
    current_tournament = latest_tournament()
    if current_tournament:
        tournament_by_id = {str(item["id"]): item for item in tournament_ranking_rows(current_tournament["id"])}
        for row in rows:
            snapshot = tournament_by_id.get(str(row["id"]))
            if snapshot:
                tournament_item = api_tournament_agent_row(snapshot, current_tournament["id"])
                for key in ("elo", "games", "wins", "losses", "draws", "first_games", "first_wins", "second_games", "second_wins", "last_record"):
                    row[key] = tournament_item[key]
                row["tournament_id"] = current_tournament["id"]
                row["tournament_name"] = current_tournament["name"]
    ready = [a for a in rows if a.get("status") == "ready"]
    return jsonify({"agents": rows, "ready_agents": ready})


@app.get("/api/agents/<path:agent_id>")
def api_agent_detail(agent_id: str):
    agent = get_agent(agent_id)
    if not agent:
        return jsonify({"error": "agent not found"}), 404
    # A round robin can easily exceed 100 games per agent (for example,
    # 17 agents x 10 games means 160 games for each participant).
    limit = int(request.args.get("limit", "10000"))
    tournament_id = (request.args.get("tournament_id") or "").strip()
    if not tournament_id:
        with db() as conn:
            latest = conn.execute(
                """
                SELECT t.id FROM tournaments t
                JOIN tournament_agents ta ON ta.tournament_id=t.id
                WHERE ta.agent_id=? ORDER BY t.created_at DESC LIMIT 1
                """,
                (agent_id,),
            ).fetchone()
        tournament_id = str(latest["id"]) if latest else ""
    with db() as conn:
        sql = """
            SELECT eg.*, a0.name AS agent0_name, a1.name AS agent1_name,
                   j.started_at AS run_started_at, j.finished_at AS run_finished_at
            FROM elo_games eg
            JOIN agents a0 ON a0.id=eg.agent0_id
            JOIN agents a1 ON a1.id=eg.agent1_id
            LEFT JOIN jobs j ON j.run_id=eg.run_id
            WHERE eg.agent0_id=? OR eg.agent1_id=?
        """
        params: list[Any] = [agent_id, agent_id]
        if tournament_id:
            sql = sql.replace("WHERE eg.agent0_id=? OR eg.agent1_id=?", "WHERE (eg.agent0_id=? OR eg.agent1_id=?) AND eg.tournament_id=?")
            params.append(tournament_id)
        else:
            sql = sql.replace("WHERE eg.agent0_id=? OR eg.agent1_id=?", "WHERE (eg.agent0_id=? OR eg.agent1_id=?) AND eg.tournament_id IS NULL")
        sql += " ORDER BY eg.id DESC LIMIT ?"
        params.append(max(1, min(limit, 50000)))
        rows = conn.execute(sql, params).fetchall()
        tournament_agent = conn.execute("SELECT * FROM tournament_agents WHERE tournament_id=? AND agent_id=?", (tournament_id, agent_id)).fetchone() if tournament_id else None
    history = []
    replay_games: dict[str, dict[int, dict[str, Any]]] = {}
    replay_availability: dict[str, bool] = {}
    for r in rows:
        row = dict(r)
        run_id = str(row["run_id"])
        if run_id not in replay_games:
            run = find_run(run_id)
            replay_availability[run_id] = bool(run and replay_path(run).is_file())
            replay_games[run_id] = {
                int(item.get("game", -1)): item
                for item in read_replay_rows(replay_path(run))
            } if replay_availability[run_id] and run else {}
        replay_game = replay_games[run_id].get(int(row["game_index"]), {})
        is_agent0 = row["agent0_id"] == agent_id
        opponent_name = row["agent1_name"] if is_agent0 else row["agent0_name"]
        result = "draw" if row["draw"] else "win" if row["winner_agent_id"] == agent_id else "loss"
        seat = "first" if row["first_agent_id"] == agent_id else "second" if row["second_agent_id"] == agent_id else "-"
        history.append({
            "run_id": row["run_id"],
            "game_index": row["game_index"],
            "opponent_name": opponent_name,
            "result": result,
            "seat": seat,
            "steps": row["steps"],
            "reason": row["reason"],
            "elo_before": float(row["elo0_before"] if is_agent0 else row["elo1_before"]),
            "elo_after": float(row["elo0_after"] if is_agent0 else row["elo1_after"]),
            "created_at": row["created_at"],
            "started_at": replay_game.get("started_at") or row["created_at"],
            "finished_at": replay_game.get("finished_at"),
            "duration_seconds": replay_game.get("duration_seconds"),
            "run_started_at": row.get("run_started_at"),
            "run_finished_at": row.get("run_finished_at"),
            "run_duration_seconds": duration_seconds(row.get("run_started_at"), row.get("run_finished_at")),
            "has_observations": bool(replay_game.get("visualize_data") or replay_game.get("visualize")),
            "replay_available": replay_availability.get(run_id, False),
            "replay_unavailable_reason": None if replay_availability.get(run_id, False) else "保存対象は直近2大会までです",
            "visualizer_url": f"/api/runs/{row['run_id']}/post/{row['game_index']}" if replay_availability.get(run_id, False) else None,
            "payload_url": f"/api/runs/{row['run_id']}/payload/{row['game_index']}" if replay_availability.get(run_id, False) else None,
            "download_url": f"/api/runs/{row['run_id']}/games/{row['game_index']}/download" if replay_availability.get(run_id, False) else None,
        })
    agent_out = api_agent_row(agent, include_checks=True)
    if tournament_agent:
        for key in ("elo", "games", "wins", "losses", "draws", "first_games", "first_wins", "second_games", "second_wins"):
            agent_out[key] = tournament_agent[key]
    tournament = next((row for row in tournament_rows() if row["id"] == tournament_id), None)
    return jsonify({"agent": agent_out, "history": history, "tournament": tournament})


@app.get("/api/agents/<path:agent_id>/meta")
def api_agent_meta(agent_id: str):
    agent = get_agent(agent_id)
    if not agent:
        return jsonify({"error": "agent not found"}), 404
    agent_path = resolve_agent_path(agent)
    deck_path = agent_path / "deck.csv"
    deck = None
    if deck_path.is_file():
        try:
            deck = deck_summary(deck_path)
            if deck["image_available"]:
                image_base = f"/api/agents/{urllib.parse.quote(agent_id, safe='')}/deck-image"
                deck["image_urls"] = {
                    language: f"{image_base}?lang={language}"
                    for language in deck["available_languages"]
                }
        except ValueError as exc:
            deck = {
                "total": 0,
                "unique": 0,
                "cards": [],
                "image_available": False,
                "available_languages": [],
                "error": str(exc),
            }
    return jsonify({"agent": api_agent_row(agent, include_checks=True), "deck": deck})


@app.get("/api/agents/<path:agent_id>/deck-image")
def api_agent_deck_image(agent_id: str):
    agent = get_agent(agent_id)
    if not agent:
        return jsonify({"error": "agent not found"}), 404
    deck_path = resolve_agent_path(agent) / "deck.csv"
    if not deck_path.is_file():
        return jsonify({"error": "deck.csv not found"}), 404
    language = request.args.get("lang", "ja")
    if language not in {"ja", "en"}:
        return jsonify({"error": "lang must be ja or en"}), 400
    try:
        cache_key = re.sub(r"[^A-Za-z0-9_.-]", "_", agent_id)
        image_path = render_deck_preview(deck_path, cache_key, language)
    except (OSError, RuntimeError, ValueError) as exc:
        return jsonify({"error": str(exc)}), 422
    return send_file(image_path, mimetype="image/webp", conditional=True, max_age=86400)


@app.get("/api/agents/<path:agent_id>/deck.csv")
def api_agent_deck_csv(agent_id: str):
    agent = get_agent(agent_id)
    if not agent or agent.get("status") == "deleted":
        return jsonify({"error": "agent not found"}), 404
    deck_path = resolve_agent_path(agent) / "deck.csv"
    if not deck_path.is_file():
        return jsonify({"error": "deck.csv not found"}), 404
    filename = secure_filename(str(agent.get("name") or "deck")) or "deck"
    return send_file(deck_path, mimetype="text/csv", as_attachment=True, download_name=f"{filename}-deck.csv")


@app.get("/api/decks")
def api_decks():
    decks: list[dict[str, Any]] = []
    for agent in agent_rows(only_ready=False):
        deck_path = resolve_agent_path(agent) / "deck.csv"
        if not deck_path.is_file():
            continue
        try:
            summary = deck_summary(deck_path)
        except ValueError:
            continue
        encoded_id = urllib.parse.quote(str(agent["id"]), safe="")
        decks.append({
            "id": f"agent:{agent['id']}",
            "name": str(agent["name"]),
            "kind": "agent",
            "agent": api_agent_row(agent),
            "deck": summary,
            "image_url": f"/api/agents/{encoded_id}/deck-image?lang={summary['available_languages'][0]}" if summary["image_available"] else None,
            "csv_url": f"/api/agents/{encoded_id}/deck.csv",
        })
    with db() as conn:
        library_rows = [dict(row) for row in conn.execute("SELECT * FROM deck_library ORDER BY created_at DESC").fetchall()]
    for item in library_rows:
        deck_path = Path(str(item["path"]))
        deck_path = deck_path if deck_path.is_absolute() else ROOT / deck_path
        if not deck_path.is_file():
            continue
        try:
            summary = deck_summary(deck_path)
        except ValueError:
            continue
        encoded_id = urllib.parse.quote(str(item["id"]), safe="")
        decks.append({
            "id": str(item["id"]),
            "name": str(item["name"]),
            "kind": "library",
            "agent": None,
            "deck": summary,
            "source_type": item.get("source_type"),
            "source_id": item.get("source_id"),
            "created_at": item.get("created_at"),
            "image_url": f"/api/decks/{encoded_id}/image?lang={summary['available_languages'][0]}" if summary["image_available"] else None,
            "csv_url": f"/api/decks/{encoded_id}/deck.csv",
        })
    return jsonify({"decks": decks})


@app.get("/api/cards")
def api_cards():
    language = request.args.get("lang", "ja")
    if language not in {"ja", "en"}:
        return jsonify({"error": "lang must be ja or en"}), 400
    try:
        names, order = card_catalog(language)
    except OSError as exc:
        return jsonify({"error": str(exc)}), 503
    cards = [
        {"id": card_id, "name": names.get(card_id, ""), "image_url": f"/api/cards/{card_id}/image?lang={language}"}
        for card_id in sorted(order, key=order.get)
    ]
    return jsonify({"language": language, "cards": cards})


@app.get("/api/cards/<int:card_id>/image")
def api_card_image(card_id: int):
    language = request.args.get("lang", "ja")
    if language not in {"ja", "en"}:
        return jsonify({"error": "lang must be ja or en"}), 400
    try:
        path = render_card_image(card_id, language)
    except (OSError, RuntimeError, ValueError) as exc:
        return jsonify({"error": str(exc)}), 404
    return send_file(path, mimetype="image/webp", conditional=True, max_age=86400)


def get_library_deck(deck_id: str) -> tuple[dict[str, Any], Path] | None:
    with db() as conn:
        row = conn.execute("SELECT * FROM deck_library WHERE id=?", (deck_id,)).fetchone()
    if not row:
        return None
    item = dict(row)
    path = Path(str(item["path"]))
    return item, path if path.is_absolute() else ROOT / path


@app.post("/api/decks")
def api_create_deck():
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name") or "").strip()
    cards = payload.get("cards")
    if not name:
        return jsonify({"error": "デッキ名を入力してください"}), 400
    if not isinstance(cards, list):
        return jsonify({"error": "cards must be an array"}), 400
    try:
        card_ids = [int(card_id) for card_id in cards]
    except (TypeError, ValueError):
        return jsonify({"error": "カードIDは整数で入力してください"}), 400
    if len(card_ids) != 60:
        return jsonify({"error": f"デッキは60枚必要です（現在 {len(card_ids)} 枚）"}), 400
    deck_id = "deck-" + datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    deck_dir = DECKS_DIR / deck_id
    deck_dir.mkdir(parents=True, exist_ok=False)
    deck_path = deck_dir / "deck.csv"
    deck_path.write_text("".join(f"{card_id}\n" for card_id in card_ids), encoding="utf-8")
    validate_deck(deck_dir)
    created_at = now_iso()
    with db() as conn:
        conn.execute(
            "INSERT INTO deck_library(id,name,path,source_type,source_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
            (deck_id, name, rel(deck_path), str(payload.get("source_type") or "created"), str(payload.get("source_id") or "") or None, created_at, created_at),
        )
    return jsonify({"ok": True, "id": deck_id, "message": f"デッキ「{name}」を登録しました"}), 201


@app.get("/api/decks/<path:deck_id>/deck.csv")
def api_library_deck_csv(deck_id: str):
    found = get_library_deck(deck_id)
    if not found or not found[1].is_file():
        return jsonify({"error": "deck not found"}), 404
    item, deck_path = found
    filename = secure_filename(str(item.get("name") or "deck")) or "deck"
    return send_file(deck_path, mimetype="text/csv", as_attachment=True, download_name=f"{filename}-deck.csv")


@app.get("/api/decks/<path:deck_id>/image")
def api_library_deck_image(deck_id: str):
    found = get_library_deck(deck_id)
    if not found or not found[1].is_file():
        return jsonify({"error": "deck not found"}), 404
    _, deck_path = found
    language = request.args.get("lang", "ja")
    if language not in {"ja", "en"}:
        return jsonify({"error": "lang must be ja or en"}), 400
    try:
        image_path = render_deck_preview(deck_path, re.sub(r"[^A-Za-z0-9_.-]", "_", deck_id), language)
    except (OSError, RuntimeError, ValueError) as exc:
        return jsonify({"error": str(exc)}), 422
    return send_file(image_path, mimetype="image/webp", conditional=True, max_age=86400)


@app.get("/api/agents/<path:agent_id>/download")
def api_agent_download(agent_id: str):
    agent = get_agent(agent_id)
    if not agent:
        return jsonify({"error": "agent not found"}), 404
    filename_stem = secure_filename(str(agent.get("name") or "agent")) or "agent"
    upload_value = str(agent.get("upload_path") or "").strip()
    if upload_value:
        upload_path = Path(upload_value)
        upload_path = upload_path if upload_path.is_absolute() else ROOT / upload_path
        if upload_path.is_file():
            return send_file(upload_path, as_attachment=True, download_name=f"{filename_stem}.tar.gz")

    agent_path = resolve_agent_path(agent)
    if not agent_path.is_dir():
        return jsonify({"error": "agent files not found"}), 404

    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode="w:gz") as output:
        def exclude_cache(info: tarfile.TarInfo) -> tarfile.TarInfo | None:
            parts = Path(info.name).parts
            return None if "__pycache__" in parts or any(part.endswith(".pyc") for part in parts) else info

        output.add(agent_path, arcname=filename_stem, filter=exclude_cache)
    archive.seek(0)
    return send_file(archive, mimetype="application/gzip", as_attachment=True, download_name=f"{filename_stem}.tar.gz")


@app.delete("/api/agents/<path:agent_id>")
def api_delete_agent(agent_id: str):
    if not _battle_operation_lock.acquire(blocking=False):
        return jsonify({"ok": False, "error": "試合を実行中です。完了後にもう一度削除してください。"}), 409
    try:
        with db() as conn:
            agent = conn.execute("SELECT * FROM agents WHERE id=?", (agent_id,)).fetchone()
            if not agent:
                return jsonify({"ok": False, "error": "agent not found"}), 404
            conn.execute(
                """
                UPDATE jobs
                SET status='failed', error=COALESCE(error,'') || '\ncancelled because agent was deleted', finished_at=COALESCE(finished_at, ?)
                WHERE (agent0_id=? OR agent1_id=?) AND status IN ('queued','running')
                """,
                (now_iso(), agent_id, agent_id),
            )
            conn.execute("UPDATE agents SET status='deleted', updated_at=? WHERE id=?", (now_iso(), agent_id))
    finally:
        _battle_operation_lock.release()

    return jsonify({"ok": True, "soft_deleted": True})


@app.get("/api/ranking")
def api_ranking():
    tournament_id = (request.args.get("tournament_id") or "").strip()
    if not tournament_id and request.args.get("scope") != "open":
        latest = latest_tournament()
        tournament_id = str(latest["id"]) if latest else ""
    tournament = next((row for row in tournament_rows() if row["id"] == tournament_id), None) if tournament_id else None
    agents = [api_tournament_agent_row(a, tournament["id"]) for a in tournament_ranking_rows(tournament["id"])] if tournament else [api_agent_row(a) for a in ranking_rows()]
    return jsonify({"agents": agents, "tournament": tournament, "elo": {"initial": ELO_INITIAL, "k": ELO_K}})


@app.get("/api/win-rate-matrix")
def api_win_rate_matrix():
    tournament_id = (request.args.get("tournament_id") or "").strip()
    if not tournament_id:
        tournament = latest_tournament()
        tournament_id = str(tournament["id"]) if tournament else ""
    agents = tournament_ranking_rows(tournament_id) if tournament_id else ranking_rows()
    agent_ids = [str(agent["id"]) for agent in agents]
    cells: dict[str, dict[str, dict[str, Any]]] = {agent_id: {} for agent_id in agent_ids}
    with db() as conn:
        rows = conn.execute(
            "SELECT agent0_id,agent1_id,winner_agent_id,draw FROM elo_games WHERE tournament_id=? ORDER BY id",
            (tournament_id,),
        ).fetchall() if tournament_id else []
    for row in rows:
        left, right = str(row["agent0_id"]), str(row["agent1_id"])
        for agent_id, opponent_id in ((left, right), (right, left)):
            cell = cells.setdefault(agent_id, {}).setdefault(opponent_id, {"games": 0, "wins": 0, "losses": 0, "draws": 0})
            cell["games"] += 1
            if row["draw"]:
                cell["draws"] += 1
            elif str(row["winner_agent_id"]) == agent_id:
                cell["wins"] += 1
            else:
                cell["losses"] += 1
    for opponents in cells.values():
        for cell in opponents.values():
            cell["win_rate"] = cell["wins"] / cell["games"] * 100.0 if cell["games"] else None
    return jsonify({
        "tournament_id": tournament_id or None,
        "agents": [{"id": str(agent["id"]), "name": str(agent["name"])} for agent in agents],
        "cells": cells,
    })


@app.get("/api/jobs")
def api_jobs():
    limit = int(request.args.get("limit", "300"))
    rows = [api_job_row(j) for j in job_rows(limit=max(1, min(limit, 1000)))]
    return jsonify({"jobs": rows, "active": any(j["status"] in ("queued", "running") for j in rows)})


@app.get("/api/jobs/<job_id>")
def api_job_detail(job_id: str):
    j = get_job(job_id)
    if not j:
        return jsonify({"error": "job not found"}), 404
    return jsonify({"job": api_job_row(j)})


@app.get("/api/runs")
def api_runs():
    return jsonify({"runs": [api_run_row(r) for r in iter_runs()]})


@app.get("/api/runs/<run_id>")
def api_run_detail(run_id: str):
    r = find_run(run_id)
    if not r:
        return jsonify({"error": "run not found"}), 404
    rows = read_replay_rows(replay_path(r))
    elo_by_game = rating_games_for_run(str(r.get("run_id", "")))
    games = []
    for row in rows:
        g = int(row.get("game", 0))
        er = elo_by_game.get(g, {})
        elo = None
        if er:
            elo = {
                "agent0_after": float(er.get("elo0_after") or 0),
                "agent1_after": float(er.get("elo1_after") or 0),
                "agent0_delta": float(er.get("elo0_after") or 0) - float(er.get("elo0_before") or 0),
                "agent1_delta": float(er.get("elo1_after") or 0) - float(er.get("elo1_before") or 0),
            }
        winner = row.get("winner")
        if winner == 0:
            winner_name = r.get("agent0_name")
        elif winner == 1:
            winner_name = r.get("agent1_name")
        elif winner == 2:
            winner_name = "draw"
        else:
            winner_name = "-"
        first_player = row.get("first_player")
        if first_player == 0:
            first_name = r.get("agent0_name")
        elif first_player == 1:
            first_name = r.get("agent1_name")
        else:
            first_name = "-"
        games.append({
            "game": g,
            "winner": winner,
            "winner_name": winner_name,
            "first_player": first_player,
            "first_name": first_name,
            "steps": row.get("steps"),
            "seat_swapped": row.get("seat_swapped"),
            "reason": row.get("reason"),
            "started_at": row.get("started_at"),
            "finished_at": row.get("finished_at"),
            "duration_seconds": row.get("duration_seconds"),
            "has_observations": bool(row.get("visualize_data") or row.get("visualize")),
            "elo": elo,
            "visualizer_url": f"/api/runs/{r['run_id']}/post/{g}",
            "payload_url": f"/api/runs/{r['run_id']}/payload/{g}",
            "download_url": f"/api/runs/{r['run_id']}/games/{g}/download",
        })
    return jsonify({"run": api_run_row(r), "games": games})


@app.post("/run")
def run_battle():
    # Backward-compatible endpoint: now it enqueues instead of blocking the request.
    return enqueue_battle()


def render_job_result(job: dict[str, Any]) -> str:
    if job.get("result_json"):
        try:
            r = json.loads(job["result_json"])
            games = int(r.get("games", 0) or 0)
            w0 = int(r.get("agent0_wins", 0) or 0)
            w1 = int(r.get("agent1_wins", 0) or 0)
            d = int(r.get("draws", 0) or 0)
            wr = (w0 / games * 100.0) if games else 0.0
            text = f"{w0}-{w1}-{d} ({wr:.1f}%)"
            elo = r.get("elo") if isinstance(r.get("elo"), dict) else {}
            if elo and elo.get("applied_games"):
                d0 = float(elo.get("agent0_delta") or 0.0)
                d1 = float(elo.get("agent1_delta") or 0.0)
                text += f" / Elo Δ {d0:+.1f}/{d1:+.1f}"
            return text
        except Exception:
            return esc(job.get("result_json"))
    return "-"


def api_job_result(job: dict[str, Any]) -> dict[str, Any] | None:
    if not job.get("result_json"):
        return None
    try:
        r = json.loads(job["result_json"])
    except Exception:
        return {"text": str(job.get("result_json") or "")}
    games = int(r.get("games", 0) or 0)
    w0 = int(r.get("agent0_wins", 0) or 0)
    w1 = int(r.get("agent1_wins", 0) or 0)
    draws = int(r.get("draws", 0) or 0)
    elo = r.get("elo") if isinstance(r.get("elo"), dict) else {}
    return {
        **r,
        "text": render_job_result(job),
        "games": games,
        "agent0_wins": w0,
        "agent1_wins": w1,
        "draws": draws,
        "agent0_win_rate": (w0 / games * 100.0) if games else 0.0,
        "elo": elo,
    }


def api_agent_row(agent: dict[str, Any], *, include_checks: bool = False) -> dict[str, Any]:
    out = dict(agent)
    out["short_id"] = str(agent.get("id", ""))[:16]
    out["elo"] = float(agent.get("elo") or ELO_INITIAL)
    out["games"] = int(agent.get("games") or 0)
    out["wins"] = int(agent.get("wins") or 0)
    out["losses"] = int(agent.get("losses") or 0)
    out["draws"] = int(agent.get("draws") or 0)
    out["first_games"] = int(agent.get("first_games") or 0)
    out["first_wins"] = int(agent.get("first_wins") or 0)
    out["second_games"] = int(agent.get("second_games") or 0)
    out["second_wins"] = int(agent.get("second_wins") or 0)
    out["last_record"] = last_record(str(agent.get("id", "")))
    out["download_url"] = f"/api/agents/{urllib.parse.quote(str(agent.get('id', '')), safe='')}/download"
    if include_checks:
        p = resolve_agent_path(agent)
        out["path"] = rel(p)
        out["has_main"] = (p / "main.py").exists()
        out["has_deck"] = (p / "deck.csv").exists()
    return out


def api_job_row(job: dict[str, Any]) -> dict[str, Any]:
    out = dict(job)
    out["result"] = api_job_result(job)
    out["download_url"] = f"/api/jobs/{job['id']}/download" if job.get("replay_path") else None
    out["replay_available"] = bool(job.get("replay_path"))
    out["replay_unavailable_reason"] = None if job.get("replay_path") or not job.get("run_id") else "保存対象は直近2大会までです"
    out["run_url"] = f"/runs/{job['run_id']}" if job.get("run_id") else None
    return out


def api_run_row(run: dict[str, Any]) -> dict[str, Any]:
    out = dict(run)
    games = int(run.get("games", 0) or 0)
    w0 = int(run.get("agent0_wins", 0) or 0)
    w1 = int(run.get("agent1_wins", 0) or 0)
    draws = int(run.get("draws", 0) or 0)
    out["agent0_win_rate"] = (w0 / games * 100.0) if games else 0.0
    out["winner_name"] = (
        run.get("agent0_name") if w0 > w1
        else run.get("agent1_name") if w1 > w0
        else "引き分け"
    )
    out["result_label"] = f"{w0}勝 - {w1}勝 - {draws}分"
    out["replay_rel"] = rel(run.get("replay", ""))
    available = bool(run.get("run_id") and replay_path(run).is_file())
    out["replay_available"] = available
    out["replay_unavailable_reason"] = None if available else "保存対象は直近2大会までです"
    out["download_url"] = f"/api/runs/{run['run_id']}/download" if available else None
    with db() as conn:
        tournament = conn.execute(
            """
            SELECT j.tournament_id, t.name AS tournament_name, j.started_at AS job_started_at, j.finished_at AS job_finished_at
            FROM jobs j LEFT JOIN tournaments t ON t.id=j.tournament_id
            WHERE j.run_id=? LIMIT 1
            """,
            (run.get("run_id"),),
        ).fetchone()
    out["tournament_id"] = tournament["tournament_id"] if tournament else None
    out["tournament_name"] = tournament["tournament_name"] if tournament else None
    out["started_at"] = out.get("started_at") or (tournament["job_started_at"] if tournament else None)
    out["finished_at"] = out.get("finished_at") or (tournament["job_finished_at"] if tournament else None)
    out["duration_seconds"] = out.get("duration_seconds")
    if out["duration_seconds"] is None:
        out["duration_seconds"] = duration_seconds(
            tournament["job_started_at"] if tournament else out.get("started_at"),
            tournament["job_finished_at"] if tournament else out.get("finished_at"),
        )
    return out


def wants_json() -> bool:
    return request.path.startswith("/api/") or "application/json" in request.headers.get("Accept", "")


def render_job_tr(j: dict[str, Any]) -> str:
    jid = str(j.get("id", ""))
    status = str(j.get("status", ""))
    link = f"<a class='btn light' href='{url_for('job_detail', job_id=jid)}'>詳細</a>"
    run_id = j.get("run_id")
    if run_id:
        link += f" <a class='btn light' href='{url_for('run_detail', run_id=run_id)}'>run</a>"
    job_type = str(j.get("job_type") or "auto")
    pri = j.get("priority", "")
    return f"<tr><td><a href='{url_for('job_detail', job_id=jid)}'>{esc(jid)}</a></td><td><span class='pill'>{esc(job_type)}</span><br><span class='small muted'>priority {esc(pri)}</span></td><td><span class='pill {esc(status)}'>{esc(status)}</span></td><td>{esc(j.get('agent0_name'))} vs {esc(j.get('agent1_name'))}</td><td>{esc(j.get('games'))}</td><td>{render_job_result(j)}</td><td>{esc(j.get('created_at'))}</td><td class='nowrap'>{link}</td></tr>"


@app.get("/jobs")
def jobs():
    rows = job_rows(limit=300)
    trs = "".join(render_job_tr(j) for j in rows)
    active = any(j["status"] in ("queued", "running") for j in rows)
    body = f"<div class='card'><h2>Jobs</h2><p class='muted'>WorkerはFlaskプロセス内のbackground threadです。画面を閉じても、<code>python app.py</code> が動いている間は処理されます。</p><table><tr><th>job</th><th>type</th><th>status</th><th>matchup</th><th>games</th><th>result</th><th>created</th><th>link</th></tr>{trs}</table></div>"
    return render_template_string(page("Jobs", body, refresh_seconds=5 if active else None))


@app.get("/jobs/<job_id>")
def job_detail(job_id: str):
    j = get_job(job_id)
    if not j:
        return Response("job not found", status=404)
    result = render_job_result(j)
    stdout = esc(j.get("stdout") or "")
    stderr = esc(j.get("stderr") or "")
    error = esc(j.get("error") or "")
    replay_link = ""
    if j.get("replay_path"):
        replay_link = f"<a class='btn secondary' href='{url_for('job_download_replay', job_id=j['id'])}'>replay JSONL download</a>"
    run_link = ""
    if j.get("run_id"):
        run_link = f"<a class='btn light' href='{url_for('run_detail', run_id=j['run_id'])}'>run詳細</a>"
    body = f"""
    <div class='card'><h2>{esc(j.get('agent0_name'))} vs {esc(j.get('agent1_name'))}</h2>
      <p><span class='pill {esc(j.get('status'))}'>{esc(j.get('status'))}</span> <code>{esc(j.get('id'))}</code></p>
      <p>type: <b>{esc(j.get('job_type') or 'auto')}</b> / priority: <b>{esc(j.get('priority'))}</b></p>
      <p>games: <b>{esc(j.get('games'))}</b> / max_steps: <b>{esc(j.get('max_steps'))}</b> / swap: <b>{'yes' if j.get('swap') else 'no'}</b></p>
      <p>created: {esc(j.get('created_at'))} / started: {esc(j.get('started_at'))} / finished: {esc(j.get('finished_at'))}</p>
      <p>result: <b>{result}</b></p>
      <p>{replay_link} {run_link}</p>
      <form method='post' action='{url_for('retry_job', job_id=j['id'])}'><button class='secondary'>Retry</button></form>
    </div>
    <div class='card'><h3>Error</h3><pre>{error}</pre></div>
    <div class='card'><h3>stdout</h3><pre>{stdout}</pre></div>
    <div class='card'><h3>stderr</h3><pre>{stderr}</pre></div>
    """
    return render_template_string(page("Job detail", body, refresh_seconds=5 if j["status"] in ("queued", "running") else None))


@app.get("/api/jobs/<job_id>/download")
@app.get("/jobs/<job_id>/download")
def job_download_replay(job_id: str):
    j = get_job(job_id)
    if not j or not j.get("replay_path"):
        return Response("replay not found", status=404)
    p = Path(j["replay_path"])
    p = p if p.is_absolute() else ROOT / p
    return send_file(p, as_attachment=True)



@app.get("/ranking")
def ranking():
    rows = ranking_rows()
    trs = []
    for i, a in enumerate(rows, start=1):
        games = int(a.get("games") or 0)
        wins = int(a.get("wins") or 0)
        losses = int(a.get("losses") or 0)
        draws = int(a.get("draws") or 0)
        fg = int(a.get("first_games") or 0)
        fw = int(a.get("first_wins") or 0)
        sg = int(a.get("second_games") or 0)
        sw = int(a.get("second_wins") or 0)
        trs.append(
            f"<tr>"
            f"<td>{i}</td>"
            f"<td>{esc(a['name'])}<br><span class='small muted'>{esc(a['id'][:16])}</span></td>"
            f"<td><b>{float(a.get('elo') or ELO_INITIAL):.1f}</b></td>"
            f"<td>{games}</td>"
            f"<td>{wins}-{losses}-{draws}<br><span class='small muted'>{pct(wins, games)}</span></td>"
            f"<td>{fw}/{fg}<br><span class='small muted'>{pct(fw, fg)}</span></td>"
            f"<td>{sw}/{sg}<br><span class='small muted'>{pct(sw, sg)}</span></td>"
            f"<td>{last_record(a['id'])}</td>"
            f"<td>{esc(a.get('created_at'))}</td>"
            f"</tr>"
        )
    body = f"""
    <div class='card'>
      <h2>Ranking</h2>
      <p class='muted'>Elo初期値 {ELO_INITIAL:.0f} / K={ELO_K:.0f}。1ゲームごとに更新。drawは0.5扱いです。</p>
      <table><tr><th>#</th><th>Agent</th><th>Elo</th><th>Games</th><th>W-L-D</th><th>First</th><th>Second</th><th>Last20</th><th>created</th></tr>{''.join(trs)}</table>
    </div>
    """
    return render_template_string(page("Ranking", body))


@app.get("/agents")
def agents():
    rows = agent_rows(only_ready=False)
    trs = []
    for a in rows:
        p = resolve_agent_path(a)
        trs.append(
            f"<tr><td>{esc(a['name'])}<br><span class='small muted'>{esc(a['id'][:16])}</span></td><td><b>{float(a.get('elo') or ELO_INITIAL):.1f}</b><br><span class='small muted'>{int(a.get('games') or 0)} games</span></td><td>{esc(a.get('source'))}</td><td><span class='pill {esc(a.get('status'))}'>{esc(a.get('status'))}</span><br><span class='small bad'>{esc(a.get('error') or '')}</span></td><td>{'OK' if (p/'main.py').exists() else 'NG'}</td><td>{'OK' if (p/'deck.csv').exists() else 'NG'}</td><td><code>{esc(rel(p))}</code></td><td>{esc(a.get('created_at'))}</td></tr>"
        )
    body = f"""
    <div class='card'>
      <h2>Agentアップロード</h2>
      {upload_form_html("".join(f"<option value='{esc(x['id'])}'>{esc(x['name'])}</option>" for x in agent_rows(only_ready=True)))}
      <p class='muted'>提出物は安全展開チェック後、<code>agents/&lt;name&gt;-&lt;hash&gt;/</code> に展開されます。</p>
    </div>
    <div class='card'><h2>Agents</h2><table><tr><th>name</th><th>Elo</th><th>source</th><th>status</th><th>main.py</th><th>deck.csv</th><th>path</th><th>created</th></tr>{''.join(trs)}</table></div>
    """
    return render_template_string(page("Agents", body))


def render_run_tr(r: dict[str, Any]) -> str:
    games = int(r.get("games", 0) or 0)
    w0 = int(r.get("agent0_wins", 0) or 0)
    w1 = int(r.get("agent1_wins", 0) or 0)
    d = int(r.get("draws", 0) or 0)
    wr = (w0 / games * 100.0) if games else 0.0
    rid = str(r.get("run_id", ""))
    return f"<tr><td><a href='{url_for('run_detail', run_id=rid)}'>{esc(rid)}</a></td><td>{esc(r.get('started_at',''))}</td><td>{esc(r.get('agent0_name'))} vs {esc(r.get('agent1_name'))}</td><td>{games}</td><td>{w0}-{w1}-{d}</td><td>{wr:.1f}%</td><td class='muted'>{esc(rel(r.get('replay','')))}</td></tr>"


@app.get("/runs")
def runs():
    rows = iter_runs()
    trs = "".join(render_run_tr(r) for r in rows)
    body = "<div class='card'><h2>履歴一覧</h2><table><tr><th>run</th><th>date</th><th>matchup</th><th>games</th><th>W-L-D</th><th>agent0 win%</th><th>replay</th></tr>" + trs + "</table></div>"
    return render_template_string(page("Runs", body))


@app.get("/runs/<run_id>")
def run_detail(run_id: str):
    r = find_run(run_id)
    if not r:
        return Response("run not found", status=404)
    rows = read_replay_rows(replay_path(r))
    elo_by_game = rating_games_for_run(str(r.get("run_id", "")))
    games_html = []
    for row in rows:
        g = int(row.get("game", 0))
        winner = row.get("winner")
        er = elo_by_game.get(g, {})
        elo_text = "-"
        if er:
            d0 = float(er.get("elo0_after") or 0) - float(er.get("elo0_before") or 0)
            d1 = float(er.get("elo1_after") or 0) - float(er.get("elo1_before") or 0)
            elo_text = f"{float(er.get('elo0_after') or 0):.1f} ({d0:+.1f}) / {float(er.get('elo1_after') or 0):.1f} ({d1:+.1f})"
        games_html.append(
            f"<tr><td>{g}</td><td>{esc(winner)}</td><td>{esc(row.get('first_player'))}</td><td>{esc(row.get('steps'))}</td><td>{esc(row.get('seat_swapped'))}</td><td>{esc(row.get('reason'))}</td><td>{esc(elo_text)}</td><td><a class='btn light' target='_blank' href='{url_for('post_page', run_id=r['run_id'], game=g)}'>Visualizer</a></td></tr>"
        )
    body = f"""
    <div class='card'><h2>{esc(r.get('agent0_name'))} vs {esc(r.get('agent1_name'))}</h2>
      <p><span class='pill'>{esc(r.get('run_id'))}</span> <span class='muted'>{esc(r.get('started_at'))}</span></p>
      <p>Result: <b>{esc(r.get('agent0_wins'))}-{esc(r.get('agent1_wins'))}-{esc(r.get('draws'))}</b> / replay: <code>{esc(rel(r.get('replay','')))}</code></p>
      <p><a class='btn secondary' href='{url_for('download_replay', run_id=r['run_id'])}'>replay JSONL download</a></p>
    </div>
    <div class='card'><h3>Games</h3><table><tr><th>game</th><th>winner</th><th>first</th><th>steps</th><th>swapped</th><th>reason</th><th>Elo after</th><th>visualizer</th></tr>{''.join(games_html)}</table></div>
    """
    return render_template_string(page("Run detail", body))


@app.get("/api/runs/<run_id>/download")
@app.get("/runs/<run_id>/download")
def download_replay(run_id: str):
    r = find_run(run_id)
    if not r:
        return Response("run not found", status=404)
    path = replay_path(r)
    if not path.is_file():
        return Response("replay expired", status=404)
    return send_file(path, as_attachment=True)


@app.get("/api/runs/<run_id>/games/<int:game>/download")
def download_game_replay(run_id: str, game: int):
    run = find_run(run_id)
    if not run:
        return jsonify({"error": "run not found"}), 404
    row = next((item for item in read_replay_rows(replay_path(run)) if int(item.get("game", -1)) == game), None)
    if row is None:
        return jsonify({"error": "game not found"}), 404

    visualize = row.get("visualize_data")
    if isinstance(visualize, str):
        try:
            observations = json.loads(visualize)
        except json.JSONDecodeError:
            observations = visualize
    else:
        observations = visualize if visualize is not None else row.get("visualize")

    game_data = {key: value for key, value in row.items() if key not in {"visualize_data", "visualize"}}
    export = {
        "format": "friend-battle-game-replay",
        "version": 1,
        "run": {
            "run_id": run_id,
            "agent0_name": run.get("agent0_name"),
            "agent1_name": run.get("agent1_name"),
            "started_at": run.get("started_at"),
        },
        "game": game_data,
        "observations": observations,
        "observation_count": len(observations) if isinstance(observations, list) else 0,
    }
    filename = f"{re.sub(r'[^A-Za-z0-9_.-]', '_', run_id)}-game-{game}.json"
    response = Response(json.dumps(export, ensure_ascii=False, indent=2), mimetype="application/json")
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def visualizer_payload_from_row(row: dict[str, Any]) -> str:
    payload = row.get("visualize_data")
    if payload is None and isinstance(row.get("steps"), list):
        try:
            payload = row["steps"][0][0]["visualize"]
        except Exception:
            payload = None
    if payload is None:
        payload = row.get("visualize")
    if payload is None:
        return ""
    if isinstance(payload, str):
        return payload
    return json.dumps(payload, ensure_ascii=False)


@app.get("/api/runs/<run_id>/post/<int:game>")
@app.get("/runs/<run_id>/post/<int:game>")
def post_page(run_id: str, game: int):
    r = find_run(run_id)
    if not r:
        return Response("run not found", status=404)
    rows = read_replay_rows(replay_path(r))
    if game < 0 or game >= len(rows):
        return Response("game not found", status=404)

    payload = visualizer_payload_from_row(rows[game])
    if not payload:
        if request.args.get("embed") == "1":
            return "<!doctype html><meta charset='utf-8'><body style='font-family:system-ui;margin:16px;color:#b00020'>このreplayには visualize_data がありません。</body>"
        body = f"""
        <div class='card'>
          <h2>Visualizer</h2>
          <p class='bad'>このreplayには visualize_data がありません。</p>
          <p><a class='btn light' href='{url_for('run_detail', run_id=r['run_id'])}'>戻る</a></p>
        </div>
        """
        return render_template_string(page("Visualizer", body))

    if request.args.get("embed") == "1":
        return f"""<!doctype html><meta charset='utf-8'>
<style>html,body{{margin:0;width:100%;height:100%;background:white}}#visualizerForm{{display:none}}</style>
<form id='visualizerForm' method='POST' action='{esc(VISUALIZER_POST_URL)}'>
  <input type='hidden' name='{esc(VISUALIZER_FIELD)}' value='{esc(payload)}'>
</form>
<script>document.getElementById('visualizerForm').submit();</script>
<noscript><button form='visualizerForm'>Open visualizer</button></noscript>"""

    body = f"""
    <div class='card'>
      <h2>Visualizerへ送信中...</h2>
      <p class='muted'>run: <code>{esc(r.get('run_id'))}</code> / game: <b>{game}</b></p>
      <form id='visualizerForm' method='POST' action='{esc(VISUALIZER_POST_URL)}'>
        <input type='hidden' name='{esc(VISUALIZER_FIELD)}' value='{esc(payload)}'>
        <button>開く</button>
        <a class='btn light' href='{url_for('payload', run_id=r['run_id'], game=game)}'>payload</a>
      </form>
      <p class='small muted'>自動で開かない場合は「開く」を押してください。</p>
    </div>
    <script>
      setTimeout(() => document.getElementById('visualizerForm').submit(), 50);
    </script>
    """
    return render_template_string(page("Visualizer", body))

@app.get("/api/runs/<run_id>/payload/<int:game>")
@app.get("/runs/<run_id>/payload/<int:game>")
def payload(run_id: str, game: int):
    r = find_run(run_id)
    if not r:
        return Response("run not found", status=404)
    rows = read_replay_rows(replay_path(r))
    if game < 0 or game >= len(rows):
        return Response("game not found", status=404)
    return Response(visualizer_payload_from_row(rows[game]), mimetype="application/json")


init_db()
sync_agent_registry()
prune_tournament_replays()


if __name__ == "__main__":
    # In debug mode, avoid starting the worker in the parent reloader process.
    debug = os.environ.get("DEBUG", "0") == "1"
    if (not debug) or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        start_worker_once()
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "5000")), debug=debug)
