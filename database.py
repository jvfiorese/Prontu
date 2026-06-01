# -*- coding: utf-8 -*-
"""
Prontu — Banco de Dados
Usa PostgreSQL se DATABASE_URL estiver definida (Railway),
senão usa SQLite local (desenvolvimento).
"""

import os
import sqlite3
from datetime import datetime, timezone

_DB_URL = os.environ.get('DATABASE_URL', '')
if _DB_URL.startswith('postgres://'):
    _DB_URL = _DB_URL.replace('postgres://', 'postgresql://', 1)
USE_PG = bool(_DB_URL)

if USE_PG:
    import psycopg2
    import psycopg2.extras
    print("[DB] PostgreSQL (Railway) OK")
else:
    _SQLITE_PATH = os.environ.get('DB_PATH', os.path.join(os.path.dirname(__file__), 'residenteai.db'))
    print(f"[DB] SQLite: {_SQLITE_PATH}")


def _conn():
    if USE_PG:
        c = psycopg2.connect(_DB_URL)
        c.autocommit = False
        return c
    else:
        c = sqlite3.connect(_SQLITE_PATH, timeout=10)
        c.row_factory = sqlite3.Row
        return c


def _q(sql):
    return sql.replace('?', '%s') if USE_PG else sql


def _one(cur):
    row = cur.fetchone()
    if row is None:
        return None
    return dict(row)


def _all(cur):
    rows = cur.fetchall()
    return [dict(r) for r in rows]


def _run(conn, sql, params=()):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) if USE_PG else conn.cursor()
    cur.execute(_q(sql), params)
    return cur


def _now():
    return datetime.now(timezone.utc).isoformat()


def init_db():
    conn = _conn()
    cur = conn.cursor()

    if USE_PG:
        statements = [
            """CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                name TEXT,
                created_at TEXT NOT NULL
            )""",
            """CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            )""",
            """CREATE TABLE IF NOT EXISTS login_attempts (
                id SERIAL PRIMARY KEY,
                ip TEXT NOT NULL,
                created_at TEXT NOT NULL
            )""",
            "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)",
            "CREATE INDEX IF NOT EXISTS idx_sessions_uid ON sessions(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_attempts_ip ON login_attempts(ip)",
        ]
        for stmt in statements:
            cur.execute(stmt)
    else:
        cur.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                name TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS login_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ip TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            CREATE INDEX IF NOT EXISTS idx_sessions_uid ON sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_attempts_ip ON login_attempts(ip);
        """)

    conn.commit()
    conn.close()
    print("[DB] Tabelas inicializadas OK")


# ── Usuários ──────────────────────────────────────────────────

def create_user(email, password_hash, name=None):
    email = email.lower().strip()
    conn = _conn()
    try:
        _run(conn, "INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)",
             (email, password_hash, name, _now()))
        conn.commit()
        cur2 = _run(conn, "SELECT * FROM users WHERE email = ?", (email,))
        return _one(cur2)
    except Exception:
        conn.rollback()
        return None
    finally:
        conn.close()


def get_user_by_email(email):
    conn = _conn()
    try:
        cur = _run(conn, "SELECT * FROM users WHERE email = ?", (email.lower().strip(),))
        return _one(cur)
    finally:
        conn.close()


def get_user_by_id(user_id):
    conn = _conn()
    try:
        cur = _run(conn, "SELECT * FROM users WHERE id = ?", (user_id,))
        return _one(cur)
    finally:
        conn.close()


def get_all_users():
    conn = _conn()
    try:
        cur = _run(conn, "SELECT id, email, name, created_at FROM users ORDER BY created_at DESC")
        return _all(cur)
    finally:
        conn.close()


# ── Sessões ───────────────────────────────────────────────────

def create_session(token, user_id, expires_at):
    conn = _conn()
    try:
        if USE_PG:
            _run(conn, """INSERT INTO sessions (token, user_id, expires_at, created_at)
                          VALUES (?, ?, ?, ?)
                          ON CONFLICT (token) DO UPDATE SET expires_at=EXCLUDED.expires_at""",
                 (token, user_id, expires_at, _now()))
        else:
            _run(conn, "INSERT OR REPLACE INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
                 (token, user_id, expires_at, _now()))
        conn.commit()
    finally:
        conn.close()


def get_session(token):
    conn = _conn()
    try:
        cur = _run(conn, "SELECT * FROM sessions WHERE token = ? AND expires_at > ?",
                   (token, _now()))
        return _one(cur)
    finally:
        conn.close()


def delete_session(token):
    conn = _conn()
    try:
        _run(conn, "DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()
    finally:
        conn.close()


def delete_user_sessions(user_id):
    conn = _conn()
    try:
        _run(conn, "DELETE FROM sessions WHERE user_id = ?", (user_id,))
        conn.commit()
    finally:
        conn.close()


# ── Rate Limiting ─────────────────────────────────────────────

def rate_limit_check(ip):
    from datetime import timedelta
    conn = _conn()
    try:
        window_start = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        cur = _run(conn, "SELECT COUNT(*) as cnt FROM login_attempts WHERE ip=? AND created_at > ?",
                   (ip, window_start))
        row = _one(cur)
        return (row['cnt'] if row else 0) >= 5
    except Exception:
        return True
    finally:
        conn.close()


def rate_limit_record(ip):
    conn = _conn()
    try:
        _run(conn, "INSERT INTO login_attempts (ip, created_at) VALUES (?, ?)", (ip, _now()))
        conn.commit()
    except Exception:
        pass
    finally:
        conn.close()


def rate_limit_clear(ip):
    conn = _conn()
    try:
        _run(conn, "DELETE FROM login_attempts WHERE ip=?", (ip,))
        conn.commit()
    except Exception:
        pass
    finally:
        conn.close()


# ── Admin ─────────────────────────────────────────────────────

def delete_user(user_id):
    conn = _conn()
    try:
        _run(conn, "DELETE FROM sessions WHERE user_id = ?", (user_id,))
        _run(conn, "DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
    finally:
        conn.close()
