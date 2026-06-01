"""
Prontu — Servidor Flask
Autenticação simples: email + senha → token de sessão (30 dias).

Rotas:
  GET  /              → Landing page (login/cadastro)
  GET  /app           → App principal (requer ?token=...)
  GET  /api/config    → Config pública
  POST /api/register  → Cadastra usuário
  POST /api/login     → Login → retorna token de sessão
  POST /api/logout    → Invalida sessão
  GET  /api/admin/users   → Lista usuários (requer X-Admin-Token)
  POST /api/admin/delete/<id> → Remove usuário (requer X-Admin-Token)
"""

import os
import re
import json
import hmac
import secrets
import logging
from datetime import datetime, timedelta, timezone
from functools import wraps

import bcrypt
from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS

from database import (
    init_db, create_user, get_user_by_email, get_user_by_id, get_all_users,
    create_session, get_session, delete_session, delete_user_sessions,
    rate_limit_check, rate_limit_record, rate_limit_clear, delete_user
)

logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

EMAIL_REGEX = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')

load_dotenv()

SECRET_KEY     = os.environ.get('RESIDENTEAI_SECRET_KEY', '')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', '')
CONTACT_EMAIL  = os.environ.get('CONTACT_EMAIL', '')
APP_VERSION    = '1.0.0'

if not SECRET_KEY:
    raise RuntimeError("RESIDENTEAI_SECRET_KEY não definida. Configure no .env ou no Railway.")
if not ADMIN_PASSWORD:
    raise RuntimeError("ADMIN_PASSWORD não definida. Configure no .env ou no Railway.")

app = Flask(__name__, static_folder='static', static_url_path='')

_CORS_ORIGINS = os.environ.get('CORS_ORIGINS', '*')
CORS(app, resources={r"/api/*": {"origins": _CORS_ORIGINS}})


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response


# ─── Helpers ─────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def check_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def _get_client_ip() -> str:
    forwarded = request.headers.get('X-Forwarded-For', '')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.remote_addr or 'unknown'


def _mask_email(email: str) -> str:
    if not email or '@' not in email:
        return '***'
    local, domain = email.split('@', 1)
    return local[:2] + '***@' + domain


def _make_session_token(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    create_session(token, user_id, expires_at)
    return token


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('X-Admin-Token', '')
        if not token or not hmac.compare_digest(token, SECRET_KEY):
            return jsonify({'error': 'Não autorizado'}), 401
        return f(*args, **kwargs)
    return decorated


# ─── Páginas ─────────────────────────────────────────────────

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')


@app.route('/app')
def app_page():
    token = request.args.get('token', '').strip()
    if not token:
        return Response(
            '<html><body style="font-family:sans-serif;padding:40px;text-align:center">'
            '<h2>⚠️ Acesso inválido</h2><p>Faça login para acessar o app.</p>'
            '<a href="/">Ir para o login</a></body></html>',
            mimetype='text/html', status=400
        )

    session = get_session(token)
    if not session:
        return Response(
            '<html><body style="font-family:sans-serif;padding:40px;text-align:center">'
            '<h2>⏰ Sessão expirada</h2><p>Faça login novamente.</p>'
            '<a href="/">Ir para o login</a></body></html>',
            mimetype='text/html', status=401
        )

    html_path = os.path.join(app.static_folder, 'app.html')
    if not os.path.exists(html_path):
        return jsonify({'error': 'Arquivo não encontrado'}), 404

    with open(html_path, 'r', encoding='utf-8') as f:
        html_content = f.read()

    user = get_user_by_id(session['user_id'])
    user_info = {
        'email':         user['email'] if user else '',
        'name':          user['name'] if user else '',
        'contact_email': CONTACT_EMAIL,
        'version':       APP_VERSION,
        'session_token': token,
    }

    injection = (
        f"\n<script>"
        f"window.__USER_INFO__ = {json.dumps(user_info)};"
        f"window.__SESSION_TOKEN__ = {json.dumps(token)};"
        f"</script>\n"
    )
    html_content = html_content.replace('</head>', f'{injection}</head>')

    return Response(html_content, mimetype='text/html')


@app.route('/api/config')
def api_config():
    return jsonify({'contact_email': CONTACT_EMAIL, 'version': APP_VERSION})


# ─── API Pública ─────────────────────────────────────────────

@app.route('/api/register', methods=['POST'])
def api_register():
    data = request.get_json(silent=True) or {}
    email    = (data.get('email') or '').strip().lower()
    password = (data.get('password') or '').strip()
    name     = (data.get('name') or '').strip()

    if len(email) > 254 or len(password) > 128 or len(name) > 100:
        return jsonify({'error': 'Dados muito longos'}), 400
    if not email or not password:
        return jsonify({'error': 'Email e senha são obrigatórios'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Senha deve ter no mínimo 6 caracteres'}), 400
    if not EMAIL_REGEX.match(email):
        return jsonify({'error': 'Email inválido'}), 400

    pw_hash = hash_password(password)
    user = create_user(email, pw_hash, name)

    if not user:
        return jsonify({'error': 'Este email já está cadastrado'}), 409

    token = _make_session_token(user['id'])
    logger.info(f"[REGISTER] Novo usuário: {_mask_email(email)}")

    return jsonify({
        'success': True,
        'session_token': token,
    }), 201


@app.route('/api/login', methods=['POST'])
def api_login():
    ip = _get_client_ip()
    if rate_limit_check(ip):
        return jsonify({'error': 'Muitas tentativas. Aguarde 5 minutos.'}), 429

    data = request.get_json(silent=True) or {}
    email    = (data.get('email') or '').strip().lower()
    password = (data.get('password') or '').strip()

    if len(email) > 254 or len(password) > 128:
        return jsonify({'error': 'Dados inválidos'}), 400
    if not email or not password:
        return jsonify({'error': 'Email e senha são obrigatórios'}), 400

    user = get_user_by_email(email)
    if not user or not check_password(password, user['password_hash']):
        rate_limit_record(ip)
        return jsonify({'error': 'Email ou senha incorretos'}), 401

    rate_limit_clear(ip)
    token = _make_session_token(user['id'])
    logger.info(f"[LOGIN] {_mask_email(email)}")

    return jsonify({
        'success': True,
        'session_token': token,
    })


@app.route('/api/logout', methods=['POST'])
def api_logout():
    data = request.get_json(silent=True) or {}
    token = (data.get('session_token') or '').strip()
    if token:
        delete_session(token)
    return jsonify({'success': True})


# ─── API Admin ────────────────────────────────────────────────

@app.route('/api/admin/users')
@admin_required
def api_admin_users():
    users = get_all_users()
    return jsonify(users)


@app.route('/api/admin/delete/<int:user_id>', methods=['POST'])
@admin_required
def api_admin_delete(user_id):
    delete_user(user_id)
    logger.warning(f"[ADMIN] Usuário removido: id={user_id}")
    return jsonify({'success': True})


# ─── Init ─────────────────────────────────────────────────────

init_db()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('DEBUG', 'True').lower() == 'true'
    print(f"\n{'='*50}")
    print(f"  Prontu")
    print(f"  Rodando em: http://localhost:{port}")
    print(f"{'='*50}\n")
    app.run(host='0.0.0.0', port=port, debug=debug)
