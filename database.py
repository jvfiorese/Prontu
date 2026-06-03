# -*- coding: utf-8 -*-
"""
Prontu — Banco de Dados
PostgreSQL (Railway) ou SQLite (local).
"""

import os
import sqlite3
from datetime import datetime, timezone, timedelta

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
    """Adapta placeholders ? → %s para PostgreSQL."""
    return sql.replace('?', '%s') if USE_PG else sql


def _one(cur):
    row = cur.fetchone()
    return dict(row) if row else None


def _all(cur):
    return [dict(r) for r in cur.fetchall()]


def _run(conn, sql, params=()):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) if USE_PG else conn.cursor()
    cur.execute(_q(sql), params)
    return cur


def _now():
    return datetime.now(timezone.utc).isoformat()


# ── Init ─────────────────────────────────────────────────────

def init_db():
    conn = _conn()
    cur  = conn.cursor()

    if USE_PG:
        stmts = [
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
            # login_attempts agora tem campo 'bucket' para separar login/register
            """CREATE TABLE IF NOT EXISTS login_attempts (
                id SERIAL PRIMARY KEY,
                ip TEXT NOT NULL,
                bucket TEXT NOT NULL DEFAULT 'login',
                created_at TEXT NOT NULL
            )""",
            # Log de acesso por IP — detecta compartilhamento de conta
            """CREATE TABLE IF NOT EXISTS access_log (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                ip TEXT NOT NULL,
                user_agent TEXT,
                path TEXT,
                created_at TEXT NOT NULL
            )""",
            # Assinaturas — stub para cobranças futuras
            """CREATE TABLE IF NOT EXISTS subscriptions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL UNIQUE,
                plan TEXT NOT NULL DEFAULT 'free',
                status TEXT NOT NULL DEFAULT 'active',
                trial_ends_at TEXT,
                expires_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )""",
            "CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email)",
            "CREATE INDEX IF NOT EXISTS idx_sessions_uid    ON sessions(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_sessions_exp    ON sessions(expires_at)",
            "CREATE INDEX IF NOT EXISTS idx_attempts_ip_bkt ON login_attempts(ip, bucket)",
            "CREATE INDEX IF NOT EXISTS idx_access_user     ON access_log(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_access_ip       ON access_log(ip)",
            "CREATE INDEX IF NOT EXISTS idx_subs_user       ON subscriptions(user_id)",
        ]
        # Migração segura: ADD COLUMN IF NOT EXISTS não falha se coluna já existe
        cur.execute("ALTER TABLE login_attempts ADD COLUMN IF NOT EXISTS bucket TEXT NOT NULL DEFAULT 'login'")
        for s in stmts:
            try:
                cur.execute(s)
            except Exception:
                conn.rollback()
                cur = conn.cursor()
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
                bucket TEXT NOT NULL DEFAULT 'login',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS access_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                ip TEXT NOT NULL,
                user_agent TEXT,
                path TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL UNIQUE,
                plan TEXT NOT NULL DEFAULT 'free',
                status TEXT NOT NULL DEFAULT 'active',
                trial_ends_at TEXT,
                expires_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
            CREATE INDEX IF NOT EXISTS idx_sessions_uid    ON sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_exp    ON sessions(expires_at);
            CREATE INDEX IF NOT EXISTS idx_attempts_ip_bkt ON login_attempts(ip, bucket);
            CREATE INDEX IF NOT EXISTS idx_access_user     ON access_log(user_id);
            CREATE INDEX IF NOT EXISTS idx_access_ip       ON access_log(ip);
            CREATE INDEX IF NOT EXISTS idx_subs_user       ON subscriptions(user_id);
        """)

    conn.commit()
    conn.close()
    print("[DB] Tabelas inicializadas OK")


# ── Usuários ──────────────────────────────────────────────────

def create_user(email, password_hash, name=None):
    email = email.lower().strip()
    conn  = _conn()
    try:
        _run(conn, "INSERT INTO users (email, password_hash, name, created_at) VALUES (?,?,?,?)",
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
            _run(conn,
                "INSERT INTO sessions (token, user_id, expires_at, created_at) "
                "VALUES (?,?,?,?) ON CONFLICT (token) DO UPDATE SET expires_at=EXCLUDED.expires_at",
                (token, user_id, expires_at, _now()))
        else:
            _run(conn,
                "INSERT OR REPLACE INTO sessions (token, user_id, expires_at, created_at) VALUES (?,?,?,?)",
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


def get_active_session_count(user_id):
    """Conta sessões ativas (não expiradas) de um usuário."""
    conn = _conn()
    try:
        cur = _run(conn,
            "SELECT COUNT(*) as cnt FROM sessions WHERE user_id = ? AND expires_at > ?",
            (user_id, _now()))
        row = _one(cur)
        return row['cnt'] if row else 0
    finally:
        conn.close()


def prune_old_sessions(user_id):
    """Remove sessões expiradas de um usuário."""
    conn = _conn()
    try:
        _run(conn, "DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?",
             (user_id, _now()))
        conn.commit()
    except Exception:
        pass
    finally:
        conn.close()


def delete_user_sessions(user_id, keep_newest=0):
    """
    Remove sessões de um usuário.
    Se keep_newest > 0, mantém as N mais recentes.
    """
    conn = _conn()
    try:
        if keep_newest > 0:
            if USE_PG:
                _run(conn,
                    "DELETE FROM sessions WHERE user_id = ? AND token NOT IN ("
                    "  SELECT token FROM sessions WHERE user_id = ? "
                    "  ORDER BY created_at DESC LIMIT ?"
                    ")",
                    (user_id, user_id, keep_newest))
            else:
                _run(conn,
                    "DELETE FROM sessions WHERE user_id = ? AND token NOT IN ("
                    "  SELECT token FROM sessions WHERE user_id = ? "
                    "  ORDER BY created_at DESC LIMIT ?"
                    ")",
                    (user_id, user_id, keep_newest))
        else:
            _run(conn, "DELETE FROM sessions WHERE user_id = ?", (user_id,))
        conn.commit()
    finally:
        conn.close()


# ── Rate Limiting (com bucket) ────────────────────────────────

def rate_limit_check(ip, bucket='login', max_attempts=5, window_minutes=5):
    """
    Verifica se o IP ultrapassou o limite de tentativas no bucket indicado.
    Buckets: 'login' (5/5min), 'register' (10/60min)
    """
    conn = _conn()
    try:
        since = (datetime.now(timezone.utc) - timedelta(minutes=window_minutes)).isoformat()
        cur = _run(conn,
            "SELECT COUNT(*) as cnt FROM login_attempts WHERE ip=? AND bucket=? AND created_at>?",
            (ip, bucket, since))
        row = _one(cur)
        return (row['cnt'] if row else 0) >= max_attempts
    except Exception:
        return False
    finally:
        conn.close()


def rate_limit_record(ip, bucket='login'):
    conn = _conn()
    try:
        _run(conn, "INSERT INTO login_attempts (ip, bucket, created_at) VALUES (?,?,?)",
             (ip, bucket, _now()))
        conn.commit()
    except Exception:
        pass
    finally:
        conn.close()


def rate_limit_clear(ip, bucket='login'):
    conn = _conn()
    try:
        _run(conn, "DELETE FROM login_attempts WHERE ip=? AND bucket=?", (ip, bucket))
        conn.commit()
    except Exception:
        pass
    finally:
        conn.close()


# ── Access Log (IP tracking) ──────────────────────────────────

def log_access(user_id, ip, user_agent='', path='/app'):
    conn = _conn()
    try:
        _run(conn,
            "INSERT INTO access_log (user_id, ip, user_agent, path, created_at) VALUES (?,?,?,?,?)",
            (user_id, ip, (user_agent or '')[:512], path, _now()))
        conn.commit()
    except Exception:
        pass
    finally:
        conn.close()


def get_user_ips(user_id, days=30):
    """IPs únicos usados pelo usuário nos últimos N dias, com contagem e último acesso."""
    conn = _conn()
    try:
        since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        cur = _run(conn,
            "SELECT ip, COUNT(*) as cnt, MAX(created_at) as last_seen "
            "FROM access_log WHERE user_id=? AND created_at>? "
            "GROUP BY ip ORDER BY last_seen DESC",
            (user_id, since))
        return _all(cur)
    finally:
        conn.close()


def get_suspicious_accounts(min_ips=3, days=7):
    """
    Contas usando >= min_ips IPs distintos nos últimos N dias.
    Indicativo forte de compartilhamento de conta.
    """
    conn = _conn()
    try:
        since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        cur = _run(conn,
            "SELECT u.id, u.email, u.name, "
            "COUNT(DISTINCT a.ip) as distinct_ips, "
            "COUNT(*) as total_accesses, "
            "MAX(a.created_at) as last_access "
            "FROM users u JOIN access_log a ON u.id=a.user_id "
            "WHERE a.created_at>? "
            "GROUP BY u.id, u.email, u.name "
            "HAVING COUNT(DISTINCT a.ip)>=? "
            "ORDER BY distinct_ips DESC",
            (since, min_ips))
        return _all(cur)
    except Exception:
        return []
    finally:
        conn.close()


# ── Assinaturas (stub) ────────────────────────────────────────

def get_subscription(user_id):
    conn = _conn()
    try:
        cur = _run(conn, "SELECT * FROM subscriptions WHERE user_id=?", (user_id,))
        return _one(cur)
    finally:
        conn.close()


def create_free_subscription(user_id, trial_days=30):
    conn = _conn()
    try:
        now         = _now()
        trial_ends  = (datetime.now(timezone.utc) + timedelta(days=trial_days)).isoformat()
        if USE_PG:
            _run(conn,
                "INSERT INTO subscriptions (user_id,plan,status,trial_ends_at,created_at,updated_at) "
                "VALUES (?,'free','trial',?,?,?) ON CONFLICT (user_id) DO NOTHING",
                (user_id, trial_ends, now, now))
        else:
            _run(conn,
                "INSERT OR IGNORE INTO subscriptions "
                "(user_id,plan,status,trial_ends_at,created_at,updated_at) VALUES (?,'free','trial',?,?,?)",
                (user_id, trial_ends, now, now))
        conn.commit()
    except Exception:
        conn.rollback()
    finally:
        conn.close()


def is_subscription_active(user_id):
    """
    Por enquanto sempre True (plataforma gratuita).
    Descomente a lógica abaixo quando ativar cobranças.
    """
    return True
    # sub = get_subscription(user_id)
    # if not sub: return False
    # if sub['status'] == 'active':
    #     return not sub['expires_at'] or sub['expires_at'] > _now()
    # if sub['status'] == 'trial':
    #     return sub['trial_ends_at'] > _now()
    # return False


# ── Admin / Stats ─────────────────────────────────────────────

def delete_user(user_id):
    conn = _conn()
    try:
        _run(conn, "DELETE FROM sessions      WHERE user_id=?", (user_id,))
        _run(conn, "DELETE FROM access_log    WHERE user_id=?", (user_id,))
        _run(conn, "DELETE FROM subscriptions WHERE user_id=?", (user_id,))
        _run(conn, "DELETE FROM users         WHERE id=?",      (user_id,))
        conn.commit()
    finally:
        conn.close()


def get_db_stats():
    """Estatísticas gerais para o painel admin."""
    conn = _conn()
    try:
        stats = {}

        cur = _run(conn, "SELECT COUNT(*) as cnt FROM users")
        stats['total_users'] = (_one(cur) or {}).get('cnt', 0)

        cur = _run(conn, "SELECT COUNT(*) as cnt FROM sessions WHERE expires_at > ?", (_now(),))
        stats['active_sessions'] = (_one(cur) or {}).get('cnt', 0)

        since_24h = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        cur = _run(conn, "SELECT COUNT(DISTINCT user_id) as cnt FROM access_log WHERE created_at > ?",
                   (since_24h,))
        stats['active_users_24h'] = (_one(cur) or {}).get('cnt', 0)

        cur = _run(conn,
            "SELECT COUNT(*) as cnt FROM ("
            "  SELECT user_id FROM access_log "
            "  WHERE created_at > ? "
            "  GROUP BY user_id HAVING COUNT(DISTINCT ip) >= 3"
            ") t",
            (since_24h,))
        stats['suspicious_accounts_24h'] = (_one(cur) or {}).get('cnt', 0)

        return stats
    except Exception as e:
        return {'error': str(e)}
    finally:
        conn.close()
