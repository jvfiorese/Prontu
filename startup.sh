#!/bin/bash
set -e
python -c "from database import init_db; init_db()"
exec gunicorn server:app --bind 0.0.0.0:${PORT:-5000} --workers 2 --timeout 60
