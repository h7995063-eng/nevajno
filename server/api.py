import os
import re
import json
import time
import hmac
import hashlib
import sqlite3
from functools import wraps
from urllib.parse import parse_qsl

from flask import Flask, request, jsonify, g, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "cybershoke.db"))
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")  # пусто = dev-режим без проверки подписи Telegram
ADMIN_IDS = {int(x) for x in os.environ.get("ADMIN_IDS", "6999358439").split(",") if x.strip().isdigit()}
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "shoke26")
PERMANENT = 4102444800  # 2100-01-01
ONLINE_TTL = 120
LOBBY_TTL = 1800
MAPS = ["Mirage", "Inferno", "Dust II", "Nuke", "Ancient", "Anubis", "Overpass", "Vertigo"]
MODES = {"1v1": 2, "2v2": 4, "5v5": 10, "DM": 16}

app = Flask(__name__, static_folder=None)

@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Init-Data, X-Dev-User, X-Admin-Password, Bypass-Tunnel-Reminder"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response

@app.route("/api/<path:_>", methods=["OPTIONS"])
def cors_preflight(_):
    return ("", 204)
ONLINE = {}

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Init-Data, X-Dev-User, X-Admin-Password, Bypass-Tunnel-Reminder, ngrok-skip-browser-warning",
    "Access-Control-Max-Age": "86400",
}


@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        return "", 204


@app.after_request
def add_headers(resp):
    for k, v in CORS_HEADERS.items():
        resp.headers[k] = v
    resp.headers["Cache-Control"] = "no-store, max-age=0"
    return resp


@app.errorhandler(Exception)
def handle_error(e):
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        return jsonify(error=e.description), e.code
    app.logger.exception(e)
    return jsonify(error="Внутренняя ошибка сервера"), 500



def now():
    return int(time.time())


def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tg_id INTEGER UNIQUE NOT NULL,
        nickname TEXT NOT NULL,
        game_id TEXT UNIQUE NOT NULL,
        elo INTEGER NOT NULL DEFAULT 1000,
        coins INTEGER NOT NULL DEFAULT 0,
        points INTEGER NOT NULL DEFAULT 0,
        kd REAL NOT NULL DEFAULT 0,
        avg REAL NOT NULL DEFAULT 0,
        is_banned INTEGER NOT NULL DEFAULT 0,
        ban_reason TEXT DEFAULT '',
        ban_until INTEGER NOT NULL DEFAULT 0,
        is_muted INTEGER NOT NULL DEFAULT 0,
        mute_until INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lobbies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_tg_id INTEGER NOT NULL,
        map TEXT NOT NULL,
        mode TEXT NOT NULL,
        max_players INTEGER NOT NULL,
        players INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'open',
        created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lobby_players (
        lobby_id INTEGER NOT NULL,
        tg_id INTEGER NOT NULL,
        PRIMARY KEY (lobby_id, tg_id)
    );
    CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lobby_id INTEGER NOT NULL,
        map TEXT NOT NULL,
        mode TEXT NOT NULL,
        started_at INTEGER NOT NULL
    );
    """)
    conn.commit()
    conn.close()


def validate_init_data(init_data):
    """Проверка подписи Telegram WebApp initData. Возвращает dict пользователя или None."""
    try:
        pairs = dict(parse_qsl(init_data, keep_blank_values=True))
        received_hash = pairs.pop("hash", "")
        check = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
        secret = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
        calc = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(calc, received_hash):
            return None
        if now() - int(pairs.get("auth_date", 0)) > 86400:
            return None
        return json.loads(pairs["user"])
    except Exception:
        return None


def tg_user():
    # --- ТЕСТОВЫЙ РЕЖИМ: сначала пробуем X-Dev-User, потом X-Init-Data ---
    dev_user = request.headers.get("X-Dev-User", "")
    if dev_user:
        try:
            return json.loads(dev_user)
        except Exception:
            pass
    if BOT_TOKEN:
        return validate_init_data(request.headers.get("X-Init-Data", ""))
    return None


def load_user(tg_id):
    row = db().execute("SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()
    if row is None:
        return None
    t = now()
    if row["is_banned"] and row["ban_until"] <= t:
        db().execute("UPDATE users SET is_banned=0, ban_reason='', ban_until=0 WHERE tg_id=?", (tg_id,))
    if row["is_muted"] and row["mute_until"] <= t:
        db().execute("UPDATE users SET is_muted=0, mute_until=0 WHERE tg_id=?", (tg_id,))
    db().commit()
    return db().execute("SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()


def public_user(row):
    return {
        "tg_id": row["tg_id"], "nickname": row["nickname"], "game_id": row["game_id"],
        "elo": row["elo"], "coins": row["coins"], "points": row["points"],
        "kd": row["kd"], "avg": row["avg"],
        "is_muted": bool(row["is_muted"]), "mute_until": row["mute_until"],
        "is_admin": row["tg_id"] in ADMIN_IDS,
    }


def ban_payload(row):
    return {"banned": True, "ban_reason": row["ban_reason"] or "не указана", "ban_until": row["ban_until"]}


def auth(allow_unregistered=False, allow_banned=False):
    def deco(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            u = tg_user()
            if not u or "id" not in u:
                return jsonify(error="Не удалось проверить Telegram-сессию"), 401
            ONLINE[u["id"]] = now()
            row = load_user(u["id"])
            g.tg = u
            g.user = row
            if row is None and not allow_unregistered:
                return jsonify(error="Сначала пройдите регистрацию"), 403
            if row is not None and row["is_banned"] and not allow_banned:
                return jsonify(ban_payload(row)), 403
            return fn(*a, **kw)
        return wrapper
    return deco


def online_count():
    t = now()
    for k in [k for k, v in ONLINE.items() if t - v > ONLINE_TTL]:
        ONLINE.pop(k, None)
    return len(ONLINE)


@app.post("/api/auth")
@auth(allow_unregistered=True, allow_banned=True)
def api_auth():
    if g.user is not None:
        if g.user["is_banned"]:
            return jsonify({"registered": True, **ban_payload(g.user)})
        return jsonify(registered=True, banned=False, user=public_user(g.user))

    body = request.get_json(silent=True) or {}
    nickname = str(body.get("nickname", "")).strip()
    game_id = str(body.get("game_id", "")).strip()
    if not nickname and not game_id:
        return jsonify(registered=False)
    if not re.fullmatch(r"[A-Za-z0-9_\-А-Яа-яЁё]{3,20}", nickname):
        return jsonify(error="Ник: 3–20 символов, буквы, цифры, _ и -"), 400
    if not re.fullmatch(r"\d{4,12}", game_id):
        return jsonify(error="ID CounterFlame: от 4 до 12 цифр"), 400
    if db().execute("SELECT 1 FROM users WHERE game_id=?", (game_id,)).fetchone():
        return jsonify(error="Этот ID CounterFlame уже зарегистрирован"), 409
    db().execute(
        "INSERT INTO users (tg_id, nickname, game_id, created_at) VALUES (?,?,?,?)",
        (g.tg["id"], nickname, game_id, now()),
    )
    db().commit()
    return jsonify(registered=True, banned=False, user=public_user(load_user(g.tg["id"])))


@app.get("/api/profile")
@auth()
def api_profile():
    return jsonify(user=public_user(g.user))


@app.get("/api/online")
@auth()
def api_online():
    in_lobbies = db().execute(
        "SELECT COALESCE(SUM(players), 0) FROM lobbies WHERE status='open' AND created_at>?",
        (now() - LOBBY_TTL,),
    ).fetchone()[0]
    return jsonify(online=online_count(), in_lobbies=in_lobbies)


@app.get("/api/leaderboard")
@auth()
def api_leaderboard():
    rows = db().execute(
        "SELECT nickname, elo, kd FROM users WHERE is_banned=0 ORDER BY elo DESC, id ASC LIMIT 20"
    ).fetchall()
    return jsonify(players=[dict(r) for r in rows])


def lobby_dict(r):
    return {"id": r["id"], "map": r["map"], "mode": r["mode"], "players": r["players"],
            "max_players": r["max_players"], "created_at": r["created_at"]}


@app.route("/api/lobbies", methods=["GET", "POST"])
@auth()
def api_lobbies():
    t = now()
    db().execute("UPDATE lobbies SET status='closed' WHERE status='open' AND created_at<?", (t - LOBBY_TTL,))
    db().commit()

    if request.method == "GET":
        rows = db().execute(
            "SELECT * FROM lobbies WHERE status='open' ORDER BY created_at DESC LIMIT 50"
        ).fetchall()
        return jsonify(lobbies=[lobby_dict(r) for r in rows])

    body = request.get_json(silent=True) or {}
    action = body.get("action", "create")
    if g.user["is_muted"]:
        return jsonify(error="Вы заглушены и не можете создавать или входить в лобби"), 403

    if action == "create":
        map_name, mode = body.get("map"), body.get("mode")
        if map_name not in MAPS or mode not in MODES:
            return jsonify(error="Неверная карта или режим"), 400
        cur = db().execute(
            "INSERT INTO lobbies (owner_tg_id, map, mode, max_players, created_at) VALUES (?,?,?,?,?)",
            (g.user["tg_id"], map_name, mode, MODES[mode], t),
        )
        db().execute("INSERT INTO lobby_players VALUES (?,?)", (cur.lastrowid, g.user["tg_id"]))
        db().commit()
        return jsonify(ok=True, id=cur.lastrowid)

    if action == "join":
        lobby = db().execute("SELECT * FROM lobbies WHERE id=? AND status='open'", (body.get("id"),)).fetchone()
        if not lobby:
            return jsonify(error="Лобби уже закрыто"), 404
        if db().execute("SELECT 1 FROM lobby_players WHERE lobby_id=? AND tg_id=?",
                        (lobby["id"], g.user["tg_id"])).fetchone():
            return jsonify(error="Вы уже в этом лобби"), 409
        players = lobby["players"] + 1
        status = "started" if players >= lobby["max_players"] else "open"
        db().execute("INSERT INTO lobby_players VALUES (?,?)", (lobby["id"], g.user["tg_id"]))
        db().execute("UPDATE lobbies SET players=?, status=? WHERE id=?", (players, status, lobby["id"]))
        if status == "started":
            db().execute("INSERT INTO matches (lobby_id, map, mode, started_at) VALUES (?,?,?,?)",
                         (lobby["id"], lobby["map"], lobby["mode"], t))
        db().commit()
        return jsonify(ok=True, started=status == "started")

    return jsonify(error="Неизвестное действие"), 400


@app.post("/api/admin")
@auth()
def api_admin():
    if g.user["tg_id"] not in ADMIN_IDS:
        return jsonify(error="Нет доступа"), 403
    if not hmac.compare_digest(request.headers.get("X-Admin-Password", ""), ADMIN_PASSWORD):
        return jsonify(error="Неверный пароль"), 403

    body = request.get_json(silent=True) or {}
    action = body.get("action", "list")
    if action == "list":
        rows = db().execute(
            "SELECT tg_id, nickname, game_id, elo, is_banned, ban_reason, ban_until, is_muted, mute_until "
            "FROM users ORDER BY id DESC LIMIT 300"
        ).fetchall()
        t = now()
        out = []
        for r in rows:
            d = dict(r)
            d["is_banned"] = bool(d["is_banned"] and d["ban_until"] > t)
            d["is_muted"] = bool(d["is_muted"] and d["mute_until"] > t)
            out.append(d)
        return jsonify(players=out)

    target = body.get("tg_id")
    if not db().execute("SELECT 1 FROM users WHERE tg_id=?", (target,)).fetchone():
        return jsonify(error="Игрок не найден"), 404
    if target in ADMIN_IDS:
        return jsonify(error="Нельзя применять наказания к администратору"), 400

    if action in ("ban", "mute"):
        try:
            minutes = int(body.get("minutes", 0))
        except (TypeError, ValueError):
            return jsonify(error="Неверное время"), 400
        until = PERMANENT if minutes <= 0 else now() + minutes * 60
        reason = str(body.get("reason", "")).strip()[:200]
        if action == "ban":
            if not reason:
                return jsonify(error="Укажите причину бана"), 400
            db().execute("UPDATE users SET is_banned=1, ban_reason=?, ban_until=? WHERE tg_id=?",
                         (reason, until, target))
        else:
            db().execute("UPDATE users SET is_muted=1, mute_until=? WHERE tg_id=?", (until, target))
    elif action == "unban":
        db().execute("UPDATE users SET is_banned=0, ban_reason='', ban_until=0 WHERE tg_id=?", (target,))
    elif action == "unmute":
        db().execute("UPDATE users SET is_muted=0, mute_until=0 WHERE tg_id=?", (target,))
    else:
        return jsonify(error="Неизвестное действие"), 400
    db().commit()
    return jsonify(ok=True)


@app.get("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/style.css")
def css():
    return send_from_directory(BASE_DIR, "style.css")


@app.get("/app.js")
def js():
    return send_from_directory(BASE_DIR, "app.js")


init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
