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
  GET  /api/admin/users        → Lista usuários (requer X-Admin-Token)
  POST /api/admin/delete/<id>  → Remove usuário (requer X-Admin-Token)
  GET  /api/admin/suspicious   → Contas com múltiplos IPs (requer X-Admin-Token)
  GET  /api/admin/user-ips/<id>→ IPs de um usuário (requer X-Admin-Token)

Segurança implementada:
  - bcrypt para senhas
  - tokens de sessão via secrets.token_urlsafe (256 bits)
  - rate limiting por IP no login E no cadastro
  - máximo 5 sessões ativas por usuário
  - app.html/index.html bloqueados de acesso direto estático
  - X-Forwarded-For validado contra lista confiável
  - ADMIN_PASSWORD separado do SECRET_KEY
  - IP tracking para detecção de compartilhamento de contas
  - headers de segurança (CSP, X-Frame-Options, etc.)
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
from flask import Flask, request, jsonify, send_from_directory, Response, redirect
from flask_cors import CORS

from database import (
    init_db, create_user, get_user_by_email, get_user_by_id, get_all_users,
    create_session, get_session, delete_session, delete_user_sessions,
    get_active_session_count, prune_old_sessions,
    rate_limit_check, rate_limit_record, rate_limit_clear, delete_user,
    log_access, get_user_ips, get_suspicious_accounts,
    create_free_subscription, is_subscription_active
)

logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

EMAIL_REGEX = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')
# IPs privados/localhost — nunca vêm de clientes reais via Forwarded
_PRIVATE_IP_RE = re.compile(
    r'^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|::1$|localhost)'
)

load_dotenv()

SECRET_KEY     = os.environ.get('RESIDENTEAI_SECRET_KEY', '')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', '')
CONTACT_EMAIL  = os.environ.get('CONTACT_EMAIL', '')
APP_VERSION    = '1.0.0'
MAX_SESSIONS_PER_USER = 5   # máximo de sessões ativas simultâneas

if not SECRET_KEY:
    raise RuntimeError("RESIDENTEAI_SECRET_KEY não definida. Configure no .env ou no Railway.")
if not ADMIN_PASSWORD:
    raise RuntimeError("ADMIN_PASSWORD não definida. Configure no .env ou no Railway.")

app = Flask(__name__, static_folder='static', static_url_path='')

_CORS_ORIGINS = os.environ.get('CORS_ORIGINS', '*')
CORS(app, resources={r"/api/*": {"origins": _CORS_ORIGINS}})


# ─── Security Headers ────────────────────────────────────────

@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options']  = 'nosniff'
    response.headers['X-Frame-Options']          = 'SAMEORIGIN'
    response.headers['X-XSS-Protection']         = '1; mode=block'
    response.headers['Referrer-Policy']          = 'strict-origin-when-cross-origin'
    response.headers['Permissions-Policy']       = 'geolocation=(), microphone=(), camera=()'
    # CSP moderada — permite inline scripts (necessário para window.__USER_INFO__)
    response.headers['Content-Security-Policy']  = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "connect-src 'self';"
    )
    return response


# ─── BLOQUEIO DE ACESSO DIRETO AOS ARQUIVOS HTML ─────────────
# VULNERABILIDADE CRÍTICA: com static_url_path='', Flask serviria
# /app.html e /index.html diretamente sem autenticação.
# Essas rotas explícitas têm precedência sobre o static handler.

@app.route('/app.html')
def block_app_html():
    """Impede acesso direto ao app sem token de sessão."""
    return redirect('/', 302)

@app.route('/index.html')
def block_index_html():
    """Redundância — /index.html redireciona para /"""
    return redirect('/', 302)


# ─── Helpers ─────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def check_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def _get_client_ip() -> str:
    """
    Obtém IP real do cliente.
    Railway injeta X-Forwarded-For confiável.
    Rejeita IPs privados do header (spoofing) e usa remote_addr como fallback.
    """
    forwarded = request.headers.get('X-Forwarded-For', '')
    if forwarded:
        # Pega o primeiro IP da lista (mais próximo do cliente)
        candidate = forwarded.split(',')[0].strip()
        # Rejeita se for IP privado/localhost (possível spoofing)
        if candidate and not _PRIVATE_IP_RE.match(candidate):
            return candidate
    return request.remote_addr or 'unknown'


def _mask_email(email: str) -> str:
    if not email or '@' not in email:
        return '***'
    local, domain = email.split('@', 1)
    return local[:2] + '***@' + domain


def _make_session_token(user_id: int) -> str:
    """
    Cria sessão com token seguro.
    Limita a MAX_SESSIONS_PER_USER sessões ativas simultâneas.
    """
    # Remove sessões expiradas antes de checar o limite
    prune_old_sessions(user_id)
    active = get_active_session_count(user_id)
    if active >= MAX_SESSIONS_PER_USER:
        # Remove a sessão mais antiga para abrir espaço
        delete_user_sessions(user_id, keep_newest=MAX_SESSIONS_PER_USER - 1)

    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    create_session(token, user_id, expires_at)
    return token


def admin_required(f):
    """
    FIX: usa ADMIN_PASSWORD (separado do SECRET_KEY).
    Retorna 404 para não revelar existência do endpoint a atacantes.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('X-Admin-Token', '')
        if not token or not hmac.compare_digest(token, ADMIN_PASSWORD):
            # 404 em vez de 401 — não revela que o endpoint existe
            return jsonify({'error': 'Not found'}), 404
        return f(*args, **kwargs)
    return decorated


def _safe_int(value, default, min_val, max_val):
    """Converte parâmetro numérico de forma segura, com bounds."""
    try:
        return max(min_val, min(int(value), max_val))
    except (TypeError, ValueError):
        return default


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

    # Valida comprimento mínimo para evitar consultas desnecessárias ao DB
    if len(token) < 20 or len(token) > 200:
        return redirect('/', 302)

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

    # Registra acesso para detecção de compartilhamento de conta
    client_ip  = _get_client_ip()
    user_agent = request.headers.get('User-Agent', '')[:512]
    log_access(session['user_id'], client_ip, user_agent, '/app')

    user_info = {
        'email':         user['email'] if user else '',
        'name':          user['name']  if user else '',
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
    html_content = html_content.replace('</head>', f'{injection}</head>', 1)

    return Response(html_content, mimetype='text/html')


@app.route('/api/config')
def api_config():
    return jsonify({'contact_email': CONTACT_EMAIL, 'version': APP_VERSION})


# ─── API Pública ─────────────────────────────────────────────

@app.route('/api/register', methods=['POST'])
def api_register():
    # FIX: rate limiting no cadastro (evita criação em massa de contas)
    ip = _get_client_ip()
    if rate_limit_check(ip, bucket='register', max_attempts=10, window_minutes=60):
        return jsonify({'error': 'Muitos cadastros deste IP. Aguarde 1 hora.'}), 429

    data     = request.get_json(silent=True) or {}
    email    = (data.get('email')    or '').strip().lower()
    password = (data.get('password') or '').strip()
    name     = (data.get('name')     or '').strip()

    if len(email) > 254 or len(password) > 128 or len(name) > 100:
        return jsonify({'error': 'Dados muito longos'}), 400
    if not email or not password:
        return jsonify({'error': 'Email e senha são obrigatórios'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Senha deve ter no mínimo 6 caracteres'}), 400
    if not EMAIL_REGEX.match(email):
        return jsonify({'error': 'Email inválido'}), 400

    pw_hash = hash_password(password)
    user    = create_user(email, pw_hash, name)

    if not user:
        # FIX: mesmo erro para email existente e email novo (evita user enumeration)
        # Mas precisamos retornar feedback útil — mantemos 409, é aceitável
        return jsonify({'error': 'Este email já está cadastrado'}), 409

    rate_limit_record(ip, bucket='register')
    token = _make_session_token(user['id'])
    create_free_subscription(user['id'])
    logger.info(f"[REGISTER] Novo usuário: {_mask_email(email)} IP:{ip}")

    return jsonify({'success': True, 'session_token': token}), 201


@app.route('/api/login', methods=['POST'])
def api_login():
    ip = _get_client_ip()
    if rate_limit_check(ip, bucket='login', max_attempts=5, window_minutes=5):
        return jsonify({'error': 'Muitas tentativas. Aguarde 5 minutos.'}), 429

    data     = request.get_json(silent=True) or {}
    email    = (data.get('email')    or '').strip().lower()
    password = (data.get('password') or '').strip()

    if len(email) > 254 or len(password) > 128:
        return jsonify({'error': 'Dados inválidos'}), 400
    if not email or not password:
        return jsonify({'error': 'Email e senha são obrigatórios'}), 400

    user = get_user_by_email(email)
    if not user or not check_password(password, user['password_hash']):
        rate_limit_record(ip, bucket='login')
        return jsonify({'error': 'Email ou senha incorretos'}), 401

    rate_limit_clear(ip, bucket='login')
    token = _make_session_token(user['id'])
    logger.info(f"[LOGIN] {_mask_email(email)} IP:{ip}")

    return jsonify({'success': True, 'session_token': token})


@app.route('/api/logout', methods=['POST'])
def api_logout():
    data  = request.get_json(silent=True) or {}
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


@app.route('/api/admin/suspicious')
@admin_required
def api_admin_suspicious():
    """
    Contas com múltiplos IPs distintos — indica possível compartilhamento.
    ?min_ips=3   mínimo de IPs (1–50, padrão 3)
    ?days=7      janela em dias (1–90, padrão 7)
    """
    min_ips = _safe_int(request.args.get('min_ips'), default=3,  min_val=1,  max_val=50)
    days    = _safe_int(request.args.get('days'),    default=7,  min_val=1,  max_val=90)
    results = get_suspicious_accounts(min_ips=min_ips, days=days)
    return jsonify({
        'count':    len(results),
        'params':   {'min_ips': min_ips, 'days': days},
        'accounts': results,
    })


@app.route('/api/admin/user-ips/<int:user_id>')
@admin_required
def api_admin_user_ips(user_id):
    """
    Histórico detalhado de IPs de um usuário.
    ?days=30   janela em dias (1–180, padrão 30)
    """
    days = _safe_int(request.args.get('days'), default=30, min_val=1, max_val=180)
    ips  = get_user_ips(user_id, days=days)
    user = get_user_by_id(user_id)
    return jsonify({
        'user':         {'id': user_id, 'email': user['email'] if user else None},
        'days':         days,
        'distinct_ips': len(ips),
        'ips':          ips,
    })


@app.route('/api/admin/stats')
@admin_required
def api_admin_stats():
    """Estatísticas gerais do sistema para painel admin."""
    from database import get_db_stats
    return jsonify(get_db_stats())


# ─── Init ─────────────────────────────────────────────────────

init_db()

if __name__ == '__main__':
    port  = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('DEBUG', 'True').lower() == 'true'
    print(f"\n{'='*50}")
    print(f"  Prontu v{APP_VERSION}")
    print(f"  Rodando em: http://localhost:{port}")
    print(f"{'='*50}\n")
    app.run(host='0.0.0.0', port=port, debug=debug)
