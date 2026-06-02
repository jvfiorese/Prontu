#!/bin/bash
set -e

echo "[startup] Rodando migrações..."
# Migração: adiciona bucket se não existir (SQLite — PostgreSQL usa IF NOT EXISTS no init_db)
python -c "
import os, sys
db_url = os.environ.get('DATABASE_URL', '')
if not db_url:
    import sqlite3
    db_path = os.environ.get('DB_PATH', '/app/residenteai.db')
    try:
        conn = sqlite3.connect(db_path)
        conn.execute(\"ALTER TABLE login_attempts ADD COLUMN bucket TEXT NOT NULL DEFAULT 'login'\")
        conn.commit()
        conn.close()
        print('[migrate] Coluna bucket adicionada')
    except Exception as e:
        print(f'[migrate] Skip: {e}')
" || true

echo "[startup] Inicializando banco..."
python -c "from database import init_db; init_db()"

echo "[startup] Iniciando gunicorn..."
exec gunicorn server:app \
    --bind 0.0.0.0:${PORT:-5000} \
    --workers 2 \
    --timeout 120 \
    --access-logfile - \
    --error-logfile -
