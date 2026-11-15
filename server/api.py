import os
import re
import json
import time
import hmac
import hashlib
import sqlite3
import threading
import urllib.request
from functools import wraps
from urllib.parse import parse_qsl

from flask import Flask, request, jsonify, g, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "cybershoke.db"))
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")  # пусто = dev-режим без проверки подписи Telegram
ADMIN_IDS = {int(x) for x in os.environ.get("ADMIN_IDS", "6999358439").split(",") if x.strip().isdigit()}
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "shoke26")
CHANNEL_ID = os.environ.get("CHANNEL_ID", "-1004336512603")
ADMIN_CHAT_ID = os.environ.get("ADMIN_CHAT_ID", "-1003741583506")
ADMIN_TOPIC_ID = os.environ.get("ADMIN_TOPIC_ID", "")  # ID темы "Проверка результатов"
PUBLIC_CHAT_ID = os.environ.get("PUBLIC_CHAT_ID", "-1004336512603")
PUBLIC_TOPIC_ID = os.environ.get("PUBLIC_TOPIC_ID", "")  # ID темы "Результаты матчей"
TOPIC_ID = os.environ.get("TOPIC_ID", "")  # ID темы «Активные матчи»; пусто = без темы
MINI_APP_URL = os.environ.get("MINI_APP_URL", "")  # https://t.me/<бот>/<приложение>
PERMANENT = 4102444800  # 2100-01-01
ONLINE_TTL = 120
LOBBY_TTL = 1800
PLAYING_TTL = 10800
TEAMS = ("KT", "T")
MAPS = ["Mirage", "Inferno", "Dust II", "Nuke", "Ancient", "Anubis", "Overpass", "Vertigo"]
MODES = {"1v1": 2, "2v2": 4, "5v5": 10, "DM": 16}

app = Flask(__name__, static_folder=None)
ONLINE = {}
LAST_NOTIFY = {}

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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


def send_channel_message(text):
    """Отправка сообщения в канал/тему с кнопкой «Открыть CYBERSHOKE». Не блокирует запрос."""
    if not BOT_TOKEN or not CHANNEL_ID:
        return
    payload = {"chat_id": CHANNEL_ID, "text": text}
    if TOPIC_ID.isdigit():
        payload["message_thread_id"] = int(TOPIC_ID)
    if MINI_APP_URL:
        payload["reply_markup"] = {"inline_keyboard": [[{"text": "Открыть CYBERSHOKE", "url": MINI_APP_URL}]]}

    def worker():
        try:
            req = urllib.request.Request(
                f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=10).read()
        except Exception as e:
            app.logger.warning("Telegram notify failed: %s", e)

    threading.Thread(target=worker, daemon=True).start()


def clean(s, n=24):
    return re.sub(r"[^\w\- ]", "", str(s or ""), flags=re.UNICODE).strip()[:n]


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
    conn = get_conn()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS news (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                author TEXT,
                created_at INTEGER DEFAULT 0
            )
        """)
        conn.commit()
    finally:
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
    for table, ddl in (
        ("lobbies", "comment TEXT NOT NULL DEFAULT ''"),
        ("lobbies", "code TEXT NOT NULL DEFAULT ''"),
        ("lobbies", "started_at INTEGER NOT NULL DEFAULT 0"),
        ("lobby_players", "team TEXT NOT NULL DEFAULT 'KT'"),
    ):
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")
        except sqlite3.OperationalError:
            pass
    conn.execute("UPDATE lobbies SET status='playing', started_at=created_at WHERE status='started'")
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
    """Порядок: X-Dev-User -> X-Init-Data (проверка HMAC) -> None."""
    dev = request.headers.get("X-Dev-User")
    if dev:
        try:
            data = json.loads(dev)
            uid = int(data.get("id"))
            if uid > 0:
                return {"id": uid, "username": str(data.get("username", "dev"))[:32]}
        except (ValueError, TypeError, AttributeError):
            pass
        return None
    init_data = request.headers.get("X-Init-Data", "")
    if init_data and BOT_TOKEN:
        return validate_init_data(init_data)
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



@app.route("/api/points/get", methods=["GET", "POST"])
def api_points_get():
    u = tg_user()
    if not u or "id" not in u:
        return jsonify(error="Не авторизован"), 401
    row = db().execute("SELECT points FROM users WHERE tg_id=?", (u["id"],)).fetchone()
    if not row:
        return jsonify(error="Пользователь не найден"), 404
    return jsonify(ok=True, points=row["points"])

@app.get("/api/profile")
@auth()
def api_profile():
    return jsonify(user=public_user(g.user))


@app.get("/api/online")
@auth()
def api_online():
    in_lobbies = db().execute(
        "SELECT COUNT(DISTINCT lp.tg_id) FROM lobby_players lp JOIN lobbies l ON l.id=lp.lobby_id "
        "WHERE l.status IN ('open','playing')"
    ).fetchone()[0]
    return jsonify(online=online_count(), in_lobbies=in_lobbies)







@app.post("/api/lobbies/<int:lobby_id>/start")
def api_lobbies_start(lobby_id):
    u = tg_user()
    if not u or "id" not in u:
        return jsonify(error="Не авторизован"), 401
    conn = db()
    row = conn.execute("SELECT * FROM lobbies WHERE id=?", (lobby_id,)).fetchone()
    if not row:
        return jsonify(error="Лобби не найдено"), 404
    if row["owner_tg_id"] != u["id"]:
        return jsonify(error="Только хост может начать матч"), 403
    if row["status"] != "open":
        return jsonify(error="Матч уже начался"), 400
    teams = json.loads(row["teams"]) if row["teams"] else {"KT": [], "T": []}
    total = len(teams.get("KT", [])) + len(teams.get("T", []))
    if total < 2:
        return jsonify(error="Для старта нужно минимум 2 игрока"), 400
    conn.execute("UPDATE lobbies SET status='playing', started_at=? WHERE id=?", (now(), lobby_id))
    conn.commit()
    return jsonify(ok=True)

@app.post("/api/lobbies/<int:lobby_id>/leave")
def api_lobbies_leave(lobby_id):
    u = tg_user()
    if not u or "id" not in u:
        return jsonify(error="Не авторизован"), 401
    conn = db()
    row = conn.execute("SELECT * FROM lobbies WHERE id=?", (lobby_id,)).fetchone()
    if not row:
        return jsonify(error="Лобби не найдено"), 404
    teams = json.loads(row["teams"]) if row["teams"] else {"KT": [], "T": []}
    total = len(teams.get("KT", [])) + len(teams.get("T", []))
    # Если лобби заполнено (2/2 и больше) и ты не хост — выйти нельзя
    if total >= row["max_players"] and row["owner_tg_id"] != u["id"]:
        return jsonify(error="Лобби заполнено, выйти нельзя"), 400
    for tm in ("KT", "T"):
        if u["id"] in teams.get(tm, []):
            teams[tm].remove(u["id"])
    if row["owner_tg_id"] == u["id"]:
        conn.execute("UPDATE lobbies SET status='closed' WHERE id=?", (lobby_id,))
    else:
        conn.execute("UPDATE lobbies SET teams=? WHERE id=?", (json.dumps(teams), lobby_id))
    conn.commit()
    return jsonify(ok=True)

@app.post("/api/lobbies/<int:lobby_id>/join")
def api_lobbies_join(lobby_id):
    u = tg_user()
    if not u or "id" not in u:
        return jsonify(error="Не авторизован"), 401
    b = request.get_json(silent=True) or {}
    team = b.get("team", "KT")
    conn = db()
    row = conn.execute("SELECT * FROM lobbies WHERE id=?", (lobby_id,)).fetchone()
    if not row:
        return jsonify(error="Лобби не найдено"), 404
    if row["status"] != "open":
        return jsonify(error="Лобби закрыто"), 400
    teams = json.loads(row["teams"]) if row["teams"] else {"KT": [], "T": []}
    if u["id"] in teams.get("KT", []) or u["id"] in teams.get("T", []):
        return jsonify(error="Вы уже в лобби"), 400
    if len(teams.get(team, [])) >= row["max_players"] // 2:
        return jsonify(error="Команда заполнена"), 400
    teams.setdefault(team, []).append(u["id"])
    conn.execute("UPDATE lobbies SET teams=? WHERE id=?", (json.dumps(teams), lobby_id))
    conn.commit()
    return jsonify(ok=True)

@app.post("/api/lobbies")
def api_lobbies_post():
    u = tg_user()
    if not u or "id" not in u:
        return jsonify(error="Не авторизован"), 401
    b = request.get_json(silent=True) or {}
    map_name = b.get("map")
    mode = b.get("mode")
    team = b.get("team", "KT")
    if map_name not in MAPS or mode not in MODES:
        return jsonify(error="Неверная карта или режим"), 400
    max_players = MODES[mode]
    teams = {"KT": [], "T": []}
    teams[team if team in teams else "KT"].append(u["id"])
    conn = db()
    cur = conn.execute(
        "INSERT INTO lobbies (creator_id, owner_tg_id, map, mode, max_players, teams, code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (u["id"], u["id"], map_name, mode, max_players, json.dumps(teams), "", now())
    )
    conn.commit()
    return jsonify(ok=True, lobby_id=cur.lastrowid)

@app.get("/api/lobbies")
def api_lobbies_get():
    rows = db().execute("SELECT * FROM lobbies WHERE status IN ('open', 'playing') ORDER BY created_at DESC LIMIT 50").fetchall()
    lobbies = []
    for r in rows:
        teams = json.loads(r["teams"]) if r["teams"] else {"KT": [], "T": []}
        lobbies.append({
            "id": r["id"],
            "owner_tg_id": r["owner_tg_id"],
            "map": r["map"],
            "mode": r["mode"],
            "max_players": r["max_players"],
            "teams": teams,
            "comment": r["comment"],
            "code": r["code"],
            "status": r["status"],
            "created_at": r["created_at"],
        })
    return jsonify(ok=True, lobbies=lobbies)

@app.get("/api/leaderboard")
@auth()
def api_leaderboard():
    rows = db().execute(
        "SELECT nickname, points, kd FROM users WHERE is_banned=0 ORDER BY points DESC, id ASC LIMIT 50"
    ).fetchall()
    return jsonify(ok=True, players=[dict(r) for r in rows])


def is_member(lobby_id, uid):
    return db().execute("SELECT 1 FROM lobby_players WHERE lobby_id=? AND tg_id=?", (lobby_id, uid)).fetchone() is not None


def get_lobby(lid, statuses=("open", "playing")):
    q = ",".join("?" * len(statuses))
    return db().execute(f"SELECT * FROM lobbies WHERE id=? AND status IN ({q})", (lid, *statuses)).fetchone()


def lobby_dict(r, uid):
    return {"id": r["id"], "map": r["map"], "mode": r["mode"], "players": r["players"],
            "max_players": r["max_players"], "status": r["status"], "created_at": r["created_at"],
            "mine": is_member(r["id"], uid)}


def lobby_detail(r, uid):
    """Полные данные лобби (комментарий, код, команды) — только для участников."""
    rows = db().execute(
        "SELECT lp.tg_id, lp.team, u.nickname FROM lobby_players lp JOIN users u ON u.tg_id=lp.tg_id "
        "WHERE lp.lobby_id=? ORDER BY lp.rowid", (r["id"],)).fetchall()
    teams = {"KT": [], "T": []}
    for x in rows:
        teams[x["team"]].append({"tg_id": x["tg_id"], "nickname": x["nickname"], "host": x["tg_id"] == r["owner_tg_id"]})
    d = lobby_dict(r, uid)
    d.update(teams=teams, comment=r["comment"] or "", code=r["code"] or "", is_host=r["owner_tg_id"] == uid)
    return d


@app.route("/api/lobbies", methods=["GET", "POST"])
@auth()
def api_lobbies():
    t = now()
    uid = g.user["tg_id"]
    db().execute(
        "UPDATE lobbies SET status='closed' WHERE (status='open' AND created_at<?) OR (status='playing' AND started_at<?)",
        (t - LOBBY_TTL, t - PLAYING_TTL))
    db().commit()

    if request.method == "GET":
        lid = request.args.get("id", type=int)
        if lid:  # «Обновить» состав лобби
            r = get_lobby(lid)
            if not r:
                return jsonify(error="Лобби не найдено или закрыто"), 404
            if not is_member(lid, uid):
                return jsonify(error="Вы не участник этого лобби"), 403
            return jsonify(lobby=lobby_detail(r, uid))
        rows = db().execute(
            "SELECT * FROM lobbies WHERE status IN ('open','playing') ORDER BY created_at DESC LIMIT 50").fetchall()
        return jsonify(lobbies=[lobby_dict(r, uid) for r in rows])

    body = request.get_json(silent=True) or {}
    action = body.get("action", "create")
    team = body.get("team") if body.get("team") in TEAMS else "KT"

    if action in ("create", "join") and g.user["is_muted"]:
        return jsonify(error="Вы заглушены и не можете создавать или входить в лобби"), 403

    if action == "create":
        map_name, mode = body.get("map"), body.get("mode")
        if map_name not in MAPS or mode not in MODES:
            return jsonify(error="Неверная карта или режим"), 400
        cur = db().execute(
            "INSERT INTO lobbies (owner_tg_id, map, mode, max_players, created_at) VALUES (?,?,?,?,?)",
            (uid, map_name, mode, MODES[mode], t))
        db().execute("INSERT INTO lobby_players (lobby_id, tg_id, team) VALUES (?,?,?)", (cur.lastrowid, uid, team))
        db().commit()
        send_channel_message(f"Новое лобби: {g.user['nickname']}\n{map_name} · {mode} · 1/{MODES[mode]}")
        return jsonify(ok=True, id=cur.lastrowid)

    r = get_lobby(body.get("id"))
    if not r:
        return jsonify(error="Лобби не найдено или закрыто"), 404
    is_host = r["owner_tg_id"] == uid

    if action == "join":
        if r["status"] != "open":
            return jsonify(error="Матч уже начался"), 409
        if is_member(r["id"], uid):
            return jsonify(error="Вы уже в этом лобби"), 409
        in_team = db().execute("SELECT COUNT(*) FROM lobby_players WHERE lobby_id=? AND team=?", (r["id"], team)).fetchone()[0]
        if in_team >= r["max_players"] // 2:
            return jsonify(error=f"Команда {team} заполнена"), 409
        players = r["players"] + 1
        db().execute("INSERT INTO lobby_players (lobby_id, tg_id, team) VALUES (?,?,?)", (r["id"], uid, team))
        db().execute("UPDATE lobbies SET players=? WHERE id=?", (players, r["id"]))
        db().commit()
        if players == 2:
            owner = db().execute("SELECT nickname FROM users WHERE tg_id=?", (r["owner_tg_id"],)).fetchone()
            send_channel_message(
                f"Новый матч: {owner['nickname'] if owner else 'Игрок'} vs {g.user['nickname']}\n"
                f"{r['map']} · {r['mode']} · {players}/{r['max_players']}")
        return jsonify(ok=True)

    if action == "leave":
        if not is_member(r["id"], uid):
            return jsonify(error="Вы не участник этого лобби"), 403
        if is_host:
            db().execute("UPDATE lobbies SET status='closed' WHERE id=?", (r["id"],))
        else:
            db().execute("DELETE FROM lobby_players WHERE lobby_id=? AND tg_id=?", (r["id"], uid))
            db().execute("UPDATE lobbies SET players=players-1 WHERE id=?", (r["id"],))
        db().commit()
        return jsonify(ok=True, closed=is_host)

    if action in ("comment", "code", "start"):
        if not is_host:
            return jsonify(error="Это действие доступно только хосту"), 403
        if action == "comment":
            db().execute("UPDATE lobbies SET comment=? WHERE id=?", (str(body.get("comment", "")).strip()[:300], r["id"]))
        elif action == "code":
            code = str(body.get("code", "")).strip()
            if not 1 <= len(code) <= 80:
                return jsonify(error="Код: от 1 до 80 символов"), 400
            db().execute("UPDATE lobbies SET code=? WHERE id=?", (code, r["id"]))
        else:
            if r["status"] != "open":
                return jsonify(error="Матч уже начался"), 409
            if r["players"] < 2:
                return jsonify(error="Для старта нужно минимум 2 игрока"), 400
            db().execute("UPDATE lobbies SET status='playing', started_at=? WHERE id=?", (t, r["id"]))
            db().execute("INSERT INTO matches (lobby_id, map, mode, started_at) VALUES (?,?,?,?)", (r["id"], r["map"], r["mode"], t))
            send_channel_message(f"Матч начался: {g.user['nickname']}\n{r['map']} · {r['mode']} · {r['players']}/{r['max_players']}")
        db().commit()
        return jsonify(ok=True)

    return jsonify(error="Неизвестное действие"), 400



@app.post("/api/match/submit")
def api_match_submit():
    u = tg_user()
    if not u or "id" not in u:
        return jsonify(error="Не авторизован"), 401

    if 'screenshot' not in request.files:
        return jsonify(error="Нет скриншота"), 400

    file = request.files['screenshot']
    if not file or file.filename == '':
        return jsonify(error="Пустой файл"), 400

    lobby_id = request.form.get("lobby_id", "?")
    # Закрываем лобби после отправки скриншота (чтобы оно не висело)
    try:
        conn = db()
        conn.execute("UPDATE lobbies SET status='closed' WHERE id=?", (int(lobby_id),))
        conn.commit()
    except Exception as e:
        app.logger.warning(f"Failed to close lobby: {e}")
    map_name = request.form.get("map", "—")
    mode = request.form.get("mode", "—")
    owner = clean(request.form.get("owner", "Игрок"))
    players_raw = request.form.get("players", "[]")
    try:
        players = json.loads(players_raw)
    except json.JSONDecodeError:
        players = []
    teams_raw = request.form.get("teams", "{}")
    try:
        teams = json.loads(teams_raw)
    except json.JSONDecodeError:
        teams = {}

    app.logger.warning(f"DEBUG: players={players}, teams={teams}")

    caption = (
        f"🎮 Новый результат на проверку!\n"
        f"Лобби: #{lobby_id}\n"
        f"Карта: {map_name} · {mode}\n"
        f"Хост: {owner}\n"
        f"Игроки: {', '.join(map(str, players))}\n"
        f"KT: {', '.join(map(str, teams.get('KT', [])))}\n"
        f"T: {', '.join(map(str, teams.get('T', [])))}\n\n"
        f"Введите статистику каждого игрока (Киллы, Смерти, Ассисты) в ответном сообщении."
    )

    def send_to_admin():
        try:
            import requests
            url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendPhoto"
            files = {'photo': (file.filename, file.read(), file.mimetype)}
            data = {'chat_id': ADMIN_CHAT_ID, 'caption': caption}
            if ADMIN_TOPIC_ID.isdigit():
                data['message_thread_id'] = int(ADMIN_TOPIC_ID)
            resp = requests.post(url, data=data, files=files, timeout=15)
            if not resp.ok:
                app.logger.error(f"Admin sendPhoto failed: {resp.text}")
        except Exception as e:
            app.logger.warning(f"Admin notify failed: {e}")

    send_to_admin()
    return jsonify(ok=True)



@app.post("/api/stats/update")
def api_stats_update():
    u = tg_user()
    if not u or "id" not in u:
        return jsonify(error="Не авторизован"), 401
    b = request.get_json(silent=True) or {}
    nickname = b.get("nickname")
    kd = b.get("kd", 0)
    avg = b.get("avg", 0)
    if not nickname:
        return jsonify(error="Нет ника"), 400
    conn = db()
    conn.execute("UPDATE users SET kd=?, avg=? WHERE nickname=?", (kd, avg, nickname))
    conn.commit()
    return jsonify(ok=True)


@app.post("/api/warn")
def api_warn():
    b = request.get_json(silent=True) or {}
    nicknames = b.get("nicknames", [])
    reason = b.get("reason", "Не подтвердил матч")
    if not nicknames:
        return jsonify(error="Нет игроков"), 400
    conn = db()
    for nick in nicknames:
        conn.execute("UPDATE users SET warns = warns + 1 WHERE nickname = ?", (nick,))
        row = conn.execute("SELECT warns FROM users WHERE nickname = ?", (nick,)).fetchone()
        if row and row["warns"] >= 3:
            # Бан на 24 часа
            import time
            ban_until = time.time() + 86400
            conn.execute("UPDATE users SET is_banned=1, ban_reason=?, ban_until=? WHERE nickname=?",
                         (f"3 варна: {reason}", str(ban_until), nick))
    conn.commit()
    return jsonify(ok=True)

@app.post("/api/points/update")
def api_points_update():
    u = tg_user()
    if not u or "id" not in u:
        return jsonify(error="Не авторизован"), 401
    b = request.get_json(silent=True) or {}
    nicknames = b.get("nicknames", [])
    points_delta = b.get("points_delta", 0)
    if not nicknames:
        return jsonify(error="Нет игроков"), 400
    conn = db()
    for nick in nicknames:
        conn.execute("UPDATE users SET points = MAX(0, points + ?) WHERE nickname = ?", (points_delta, nick))
    conn.commit()
    return jsonify(ok=True)




@app.delete("/api/news/<int:news_id>")
def api_news_delete(news_id):
    u = tg_user()
    if not u or "id" not in u:
        return jsonify(error="Не авторизован"), 401
    if u["id"] not in ADMIN_IDS:
        return jsonify(error="Только для админов"), 403
    conn = db()
    conn.execute("DELETE FROM news WHERE id=?", (news_id,))
    conn.commit()
    return jsonify(ok=True)

@app.post("/api/news")
def api_news_post():
    u = tg_user()
    if not u or "id" not in u:
        return jsonify(error="Не авторизован"), 401
    if u["id"] not in ADMIN_IDS:
        return jsonify(error="Только для админов"), 403

    title = request.form.get("title", "").strip()
    content = request.form.get("content", "").strip()
    if not title or not content:
        return jsonify(error="Заполните заголовок и текст"), 400

    photo_id = ""
    if 'photo' in request.files:
        file = request.files['photo']
        if file and file.filename:
            import requests
            files = {'photo': (file.filename, file.read(), file.mimetype)}
            resp = requests.post(
                f"https://api.telegram.org/bot{BOT_TOKEN}/sendPhoto",
                data={"chat_id": ADMIN_CHAT_ID, "caption": f"Фото для новости: {title}"},
                files=files, timeout=15
            )
            if resp.ok:
                photo_id = resp.json()["result"]["photo"][-1]["file_id"]

    conn = db()
    conn.execute(
        "INSERT INTO news (title, content, photo_id, created_at) VALUES (?, ?, ?, ?)",
        (title, content, photo_id, now())
    )
    conn.commit()
    return jsonify(ok=True)


@app.get("/api/news/photo/<file_id>")
def api_news_photo(file_id):
    import requests
    from flask import Response
    try:
        # Получаем путь к файлу через Telegram API
        r = requests.get(f"https://api.telegram.org/bot{BOT_TOKEN}/getFile?file_id={file_id}", timeout=10)
        data = r.json()
        if not data.get("ok"):
            return jsonify(error="Файл не найден"), 404
        file_path = data["result"]["file_path"]
        # Скачиваем файл
        file_url = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file_path}"
        file_resp = requests.get(file_url, timeout=15)
        if not file_resp.ok:
            return jsonify(error="Ошибка скачивания"), 500
        return Response(file_resp.content, mimetype=file_resp.headers.get("Content-Type", "image/jpeg"))
    except Exception as e:
        return jsonify(error=str(e)), 500

@app.get("/api/news")
def api_news_get():
    rows = db().execute("SELECT * FROM news ORDER BY created_at DESC LIMIT 50").fetchall()
    news = [{"id": r["id"], "title": r["title"], "content": r["content"], "author": r["author"], "photo_id": r["photo_id"] if "photo_id" in r.keys() else "", "created_at": r["created_at"]} for r in rows]
    return jsonify(ok=True, news=news)

@app.post("/api/notify")
def api_notify():
    u = tg_user()
    if not u or "id" not in u:
        return jsonify(error="Не авторизован"), 401
    b = request.get_json(silent=True) or {}
    lobby_id = b.get("lobby_id")
    map_name = b.get("map", "—")
    mode = b.get("mode", "—")
    players = b.get("players", 1)
    max_players = b.get("max_players", 2)
    owner = clean(b.get("owner")) or "Игрок"
    joiner = b.get("joiner")
    notify_type = b.get("type", "create")

    text = (
        f"🎮 Лобби #{lobby_id}\n"
        f"Карта: {map_name} · {mode}\n"
        f"Хост: {owner}\n"
        f"Игроки: {players}/{max_players}"
    )
    if joiner:
        text += f"\nЗашёл: {clean(joiner)}"

    import requests
    conn = db()
    row = conn.execute("SELECT channel_message_id FROM lobbies WHERE id=?", (lobby_id,)).fetchone()
    msg_id = row["channel_message_id"] if row and row["channel_message_id"] else 0

    if notify_type == "create" or not msg_id:
        data = {"chat_id": CHANNEL_ID, "text": text}
        if TOPIC_ID.isdigit():
            data["message_thread_id"] = int(TOPIC_ID)
        # Добавляем кнопку "Открыть CYBERSHOKE"
        reply_markup = {
            "inline_keyboard": [[
                {"text": "🎮 Открыть CYBERSHOKE", "url": f"https://t.me/CYBERSHOK_KFBOT/cybershoke"}
            ]]
        }
        data["reply_markup"] = json.dumps(reply_markup)
        resp = requests.post(f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage", data=data, timeout=10)
        if resp.ok:
            new_msg_id = resp.json()["result"]["message_id"]
            conn.execute("UPDATE lobbies SET channel_message_id=? WHERE id=?", (new_msg_id, lobby_id))
            conn.commit()
    else:
        requests.post(
            f"https://api.telegram.org/bot{BOT_TOKEN}/editMessageText",
            data={"chat_id": CHANNEL_ID, "message_id": msg_id, "text": text},
            timeout=10
        )
    conn.close()
    return jsonify(ok=True)


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


@app.get("/assets/<path:name>")
def assets(name):
    return send_from_directory(os.path.join(BASE_DIR, "assets"), name)


@app.get("/<path:name>")
def static_files(name):
    if name in ("index.html", "style.css", "app.js"):
        return send_from_directory(BASE_DIR, name)
    return jsonify(error="Не найдено"), 404


init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
