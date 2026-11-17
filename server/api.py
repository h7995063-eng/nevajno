import os
import re
import json
import time
import hmac
import html
import random
import hashlib
import secrets
import sqlite3
import threading
import urllib.error
import urllib.request
from functools import wraps
from urllib.parse import parse_qsl

from flask import Flask, request, jsonify, g, send_from_directory
import requests

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DOCS_DIR = os.path.join(os.path.dirname(BASE_DIR), "docs")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "cybershoke.db"))



try:
    from config import BOT_TOKEN
except ImportError:
    BOT_TOKEN = "9226738939:AAFO3UtMr_3Mg4l_JqqC1CT_Hsa8dWh6vWA"

LOG_CHAT_ID = -1004336512603
LOG_THREAD_ID = 32

def send_punishment_log(nickname, action_type, reason, admin_name, duration="Навсегда"):
    if action_type == "ban":
        title = "🚫 Игрок забанен"
    elif action_type == "mute":
        title = "🔇 Игрок заглушен"
    elif action_type == "warn":
        title = "⚠️ Игрок получил варн"
    else:
        title = "🛑 Наказание"

    text = (
        f"{title}\n"
        f"├ Игрок: {nickname}\n"
        f"├ Причина: {reason}\n"
        f"└ {duration}\n"
        f"├ забанил администратор {admin_name}"
    )

    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": LOG_CHAT_ID,
        "message_thread_id": LOG_THREAD_ID,
        "text": text,
        "parse_mode": "HTML"
    }

    try:
        requests.post(url, json=payload, timeout=5)
    except Exception:
        pass

def load_token():
    token = os.environ.get("BOT_TOKEN", "").strip()
    if token:
        return token
    for path in (os.path.join(BASE_DIR, "config.py"), os.path.join(os.path.dirname(BASE_DIR), "bot", "config.py")):
        try:
            with open(path, encoding="utf-8") as f:
                found = re.search(r"BOT_TOKEN\s*=\s*(?:os\.environ\.get\([^)]*\)\s*or\s*)?[\"']([0-9]{6,}:[^\"']+)[\"']", f.read())
            if found:
                return found.group(1).strip()
        except OSError:
            continue
    return ""


BOT_TOKEN = load_token()
STRICT_AUTH = os.environ.get("STRICT_AUTH", "") == "1"
ADMIN_IDS = {int(x) for x in os.environ.get("ADMIN_IDS", "6999358439").split(",") if x.strip().isdigit()}
OWNER_IDS = {int(x) for x in os.environ.get("OWNER_IDS", "").split(",") if x.strip().isdigit()} or set(sorted(ADMIN_IDS)[:1])
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "shoke26")
CHANNEL_ID = os.environ.get("CHANNEL_ID", "-1004336512603")
ADMIN_CHAT_ID = os.environ.get("ADMIN_CHAT_ID", "-1003741583506")
ADMIN_TOPIC_ID = os.environ.get("ADMIN_TOPIC_ID", "")
TOPIC_MATCHES = os.environ.get("TOPIC_MATCHES", "4")
TOPIC_NEWS = os.environ.get("TOPIC_NEWS", "6")
MINI_APP_URL = os.environ.get("MINI_APP_URL", "")

PERMANENT = 4102444800
ONLINE_TTL = 120
LOBBY_TTL = 1800
PLAYING_TTL = 10800
CONFIRM_SECONDS = int(os.environ.get("CONFIRM_SECONDS", "60"))
FINISHED_KEEP = 3600
POINTS_WIN = 20
POINTS_LOSS = 15
PLAN_BONUS = {"premium": 0.25, "lite": 0.10}
TEAMS = ("KT", "T")
MAPS = ["Mirage", "Inferno", "Dust II", "Nuke", "Ancient", "Anubis", "Overpass", "Vertigo"]
MODES = {"1v1": 2, "2v2": 4, "5v5": 10, "DM": 10}
ACTIVE = ("open", "confirming", "playing", "review")

BADGE_ORDER = ["owner", "admin", "dev", "mod", "vip", "premium", "lite", "pixel"]
GRANTABLE_BADGES = ["dev", "mod", "vip", "pixel", "admin", "owner"]
PRESET_BANNERS = ["flame", "ice", "neon", "gold", "void", "sakura", "toxic", "sunset"]
BANNER_UPLOAD_PLANS = ("premium", "lite")
IMAGE_MAX_BYTES = 5 * 1024 * 1024

app = Flask(__name__, static_folder=None)

app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024
ONLINE = {}
LAST_NOTIFY = {}
LOCK = threading.RLock()

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Init-Data, X-Dev-User, X-Admin-Password, X-Bot-Secret, Bypass-Tunnel-Reminder, ngrok-skip-browser-warning",
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
    if not request.path.startswith("/uploads/"):
        resp.headers["Cache-Control"] = "no-store, max-age=0"
    return resp


@app.errorhandler(Exception)
def handle_error(e):
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        text = "Файл слишком большой" if e.code == 413 else e.description
        return jsonify(error=text), e.code
    app.logger.exception(e)
    return jsonify(error="Внутренняя ошибка сервера"), 500


def now():
    return int(time.time())


def num(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def clean(s, n=24):
    return re.sub(r"[^\w\- ]", "", str(s or ""), flags=re.UNICODE).strip()[:n]


def connect():
    con = sqlite3.connect(DB_PATH, timeout=15)
    con.row_factory = sqlite3.Row
    try:
        con.execute("PRAGMA journal_mode=WAL")
    except sqlite3.DatabaseError:
        pass
    return con


def db():
    if "db" not in g:
        g.db = connect()
    return g.db


@app.teardown_appcontext
def close_db(_):
    con = g.pop("db", None)
    if con is not None:
        con.close()


def columns(con, table):
    return [r[1] for r in con.execute(f"PRAGMA table_info({table})")]


def table_exists(con, table):
    return con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone() is not None


def add_columns(con, table, wanted):
    have = columns(con, table)
    for name, ddl in wanted.items():
        if name not in have:
            con.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")


def retire_if_incompatible(con, table, supplied):
    if not table_exists(con, table):
        return
    info = con.execute(f"PRAGMA table_info({table})").fetchall()
    names = {r[1] for r in info}
    blocking = [r[1] for r in info if r[3] and r[4] is None and not r[5] and r[1] not in supplied]
    if not set(supplied) <= names or blocking:
        con.execute(f"ALTER TABLE {table} RENAME TO {table}_legacy_{now()}")


def init_db():
    con = connect()
    retire_if_incompatible(con, "lobbies", {"owner_tg_id", "map", "mode", "max_players", "players", "status", "created_at"})
    retire_if_incompatible(con, "lobby_players", {"lobby_id", "tg_id"})
    retire_if_incompatible(con, "matches", {"lobby_id", "map", "mode", "started_at"})
    con.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tg_id INTEGER UNIQUE NOT NULL,
        nickname TEXT NOT NULL,
        game_id TEXT UNIQUE NOT NULL,
        elo INTEGER NOT NULL DEFAULT 1000,
        coins INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT 0
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
    CREATE TABLE IF NOT EXISTS match_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id INTEGER NOT NULL,
        tg_id INTEGER NOT NULL,
        nickname TEXT NOT NULL,
        team TEXT NOT NULL DEFAULT 'KT',
        kills INTEGER NOT NULL DEFAULT 0,
        deaths INTEGER NOT NULL DEFAULT 0,
        assists INTEGER NOT NULL DEFAULT 0,
        won INTEGER NOT NULL DEFAULT 0,
        points_change INTEGER NOT NULL DEFAULT 0,
        points_total INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author_tg_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        image TEXT NOT NULL DEFAULT '',
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS uploads (
        name TEXT PRIMARY KEY,
        tg_id INTEGER NOT NULL,
        purpose TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );
    """)
    add_columns(con, "users", {
        "points": "INTEGER NOT NULL DEFAULT 0", "kd": "REAL NOT NULL DEFAULT 0", "avg": "REAL NOT NULL DEFAULT 0",
        "is_banned": "INTEGER NOT NULL DEFAULT 0", "ban_reason": "TEXT DEFAULT ''", "ban_until": "INTEGER NOT NULL DEFAULT 0",
        "is_muted": "INTEGER NOT NULL DEFAULT 0", "mute_until": "INTEGER NOT NULL DEFAULT 0",
        "badges": "TEXT NOT NULL DEFAULT ''", "banner": "TEXT NOT NULL DEFAULT ''",
        "plan": "TEXT NOT NULL DEFAULT ''", "plan_until": "INTEGER NOT NULL DEFAULT 0",
        "matches_played": "INTEGER NOT NULL DEFAULT 0", "wins": "INTEGER NOT NULL DEFAULT 0",
        "kills_total": "INTEGER NOT NULL DEFAULT 0", "deaths_total": "INTEGER NOT NULL DEFAULT 0",
        "assists_total": "INTEGER NOT NULL DEFAULT 0",
        "verified": "INTEGER NOT NULL DEFAULT 0", "avatar": "TEXT NOT NULL DEFAULT ''",
    })
    add_columns(con, "lobbies", {
        "comment": "TEXT NOT NULL DEFAULT ''", "code": "TEXT NOT NULL DEFAULT ''",
        "started_at": "INTEGER NOT NULL DEFAULT 0", "host_tg_id": "INTEGER NOT NULL DEFAULT 0",
        "confirm_until": "INTEGER NOT NULL DEFAULT 0", "finished_at": "INTEGER NOT NULL DEFAULT 0",
    })
    add_columns(con, "lobby_players", {
        "team": "TEXT NOT NULL DEFAULT 'KT'", "joined_at": "INTEGER NOT NULL DEFAULT 0",
        "confirmed": "INTEGER NOT NULL DEFAULT 0",
    })
    add_columns(con, "matches", {
        "winner": "TEXT NOT NULL DEFAULT ''", "finished_at": "INTEGER NOT NULL DEFAULT 0",
        "applied": "INTEGER NOT NULL DEFAULT 0",
    })
    con.execute("UPDATE lobbies SET status='playing', started_at=created_at WHERE status='started'")
    con.commit()
    con.close()
    os.makedirs(UPLOAD_DIR, exist_ok=True)


def tg_request(method, payload=None, body=None, content_type="application/json"):
    if not BOT_TOKEN:
        return False, "Сервер не знает токен бота"
    data = body if body is not None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{BOT_TOKEN}/{method}", data=data, headers={"Content-Type": content_type})
    try:
        urllib.request.urlopen(req, timeout=15).read()
        return True, ""
    except urllib.error.HTTPError as e:
        try:
            desc = json.loads(e.read().decode("utf-8")).get("description", "")
        except Exception:
            desc = ""
        return False, desc or f"HTTP {e.code}"
    except Exception as e:
        return False, type(e).__name__


def tg_call(method, payload):
    if not BOT_TOKEN:
        return

    def worker():
        ok, desc = tg_request(method, payload)
        if not ok:
            app.logger.warning("Telegram %s failed: %s", method, desc)

    threading.Thread(target=worker, daemon=True).start()


def channel_payload(text, topic):
    payload = {"chat_id": CHANNEL_ID, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True}
    if str(topic).isdigit():
        payload["message_thread_id"] = int(topic)
    if MINI_APP_URL:
        payload["reply_markup"] = {"inline_keyboard": [[{"text": "Открыть CYBERSHOKE", "url": MINI_APP_URL}]]}
    return payload


def send_channel_message(text, topic=None):
    if not CHANNEL_ID:
        return
    tg_call("sendMessage", channel_payload(html.escape(text), topic or TOPIC_MATCHES))


def send_channel_post(title, body, image):
    if not CHANNEL_ID:
        return
    text = f"<b>{html.escape(title)}</b>"
    if body:
        text += "\n\n" + html.escape(body)

    def worker():
        content, name = None, ""
        if image.startswith("/uploads/"):
            name = image.rsplit("/", 1)[-1]
            try:
                with open(os.path.join(UPLOAD_DIR, name), "rb") as f:
                    content = f.read()
            except OSError:
                content = None
        if content is not None or image.startswith("https://"):
            caption = text[:1000]
            if content is not None:
                mimetype = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}.get(name.rsplit(".", 1)[-1], "image/jpeg")
                boundary, data = multipart_photo(CHANNEL_ID, name, content, mimetype, caption, TOPIC_NEWS, "HTML")
                ok, desc = tg_request("sendPhoto", body=data, content_type=f"multipart/form-data; boundary={boundary}")
            else:
                payload = {"chat_id": CHANNEL_ID, "photo": image, "caption": caption, "parse_mode": "HTML"}
                if TOPIC_NEWS.isdigit():
                    payload["message_thread_id"] = int(TOPIC_NEWS)
                ok, desc = tg_request("sendPhoto", payload)
        else:
            ok, desc = tg_request("sendMessage", channel_payload(text[:4000], TOPIC_NEWS))
        if not ok:
            app.logger.warning("Telegram news post failed: %s", desc)

    threading.Thread(target=worker, daemon=True).start()


def send_user(tg_id, text):
    payload = {"chat_id": tg_id, "text": text, "parse_mode": "HTML"}
    if MINI_APP_URL.startswith("https://"):
        payload["reply_markup"] = {"inline_keyboard": [[{"text": "Открыть CYBERSHOKE", "web_app": {"url": MINI_APP_URL}}]]}
    tg_call("sendMessage", payload)


def multipart_photo(chat_id, filename, content, mimetype, caption, thread_id, parse_mode=None):
    boundary = "----cs" + secrets.token_hex(12)
    parts = []

    def field(name, value):
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode("utf-8"))

    field("chat_id", chat_id)
    field("caption", caption)
    if parse_mode:
        field("parse_mode", parse_mode)
    if thread_id:
        field("message_thread_id", thread_id)
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="photo"; filename="{filename}"\r\nContent-Type: {mimetype}\r\n\r\n'.encode("utf-8")
        + content + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    return boundary, b"".join(parts)


def send_photo_to_admin(filename, content, mimetype, caption):
    if not BOT_TOKEN:
        return False
    boundary, body = multipart_photo(
        ADMIN_CHAT_ID, filename, content, mimetype, caption,
        int(ADMIN_TOPIC_ID) if ADMIN_TOPIC_ID.isdigit() else None,
    )
    try:
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{BOT_TOKEN}/sendPhoto", data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        urllib.request.urlopen(req, timeout=25).read()
        return True
    except Exception as e:
        app.logger.warning("Admin sendPhoto failed: %s", type(e).__name__)
        return False


def validate_init_data(init_data):
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
    init_data = request.headers.get("X-Init-Data", "")
    if init_data and BOT_TOKEN:
        verified = validate_init_data(init_data)
        if verified and "id" in verified:
            return verified
    if not STRICT_AUTH:
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


def load_user(tg_id):
    con = db()
    row = con.execute("SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()
    if row is None:
        return None
    t = now()
    if row["is_banned"] and num(row["ban_until"]) <= t:
        con.execute("UPDATE users SET is_banned=0, ban_reason='', ban_until=0 WHERE tg_id=?", (tg_id,))
    if row["is_muted"] and num(row["mute_until"]) <= t:
        con.execute("UPDATE users SET is_muted=0, mute_until=0 WHERE tg_id=?", (tg_id,))
    if row["plan"] and num(row["plan_until"]) <= t:
        con.execute("UPDATE users SET plan='', plan_until=0 WHERE tg_id=?", (tg_id,))
    con.commit()
    return con.execute("SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()


def active_plan(row):
    return row["plan"] if row["plan"] in PLAN_BONUS and num(row["plan_until"]) > now() else ""


def badge_ids(row):
    stored = [b for b in str(row["badges"] or "").split(",") if b]
    out = set(stored)
    if row["tg_id"] in OWNER_IDS:
        out.add("owner")
    elif row["tg_id"] in ADMIN_IDS:
        out.add("admin")
    plan = active_plan(row)
    if plan:
        out.add(plan)
    return [b for b in BADGE_ORDER if b in out]


def public_user(row, con=None):
    data = {
        "tg_id": row["tg_id"], "nickname": row["nickname"], "game_id": row["game_id"],
        "elo": row["elo"], "coins": row["coins"], "points": row["points"],
        "kd": row["kd"], "avg": row["avg"],
        "is_muted": bool(row["is_muted"]), "mute_until": num(row["mute_until"]),
        "is_admin": row["tg_id"] in ADMIN_IDS,
        "badges": badge_ids(row), "banner": row["banner"] or "",
        "plan": active_plan(row), "plan_until": num(row["plan_until"]) if active_plan(row) else 0,
        "matches": num(row["matches_played"]), "wins": num(row["wins"]),
        "can_upload_banner": can_upload_banner(row),
        "uid": row["id"], "verified": bool(row["verified"]), "avatar": row["avatar"] or "",
        "winrate": winrate(row),
    }
    if con is not None:
        data["rank"] = con.execute(
            "SELECT COUNT(*) FROM users WHERE is_banned=0 AND (points>? OR (points=? AND id<?))",
            (row["points"], row["points"], row["id"]),
        ).fetchone()[0] + 1
    return data


def winrate(row):
    played = num(row["matches_played"])
    return round(100 * num(row["wins"]) / played) if played else 0


def card_user(row):
    return {
        "id": row["id"], "nickname": row["nickname"], "avatar": row["avatar"] or "", "banner": row["banner"] or "",
        "badges": badge_ids(row), "verified": bool(row["verified"]),
    }


def can_upload_banner(row):
    stored = set(str(row["badges"] or "").split(","))
    return (
        row["tg_id"] in ADMIN_IDS
        or bool(active_plan(row))
        or bool(stored & {"vip", "dev", "mod", "admin", "owner"})
    )


def ban_payload(row):
    return {"banned": True, "ban_reason": row["ban_reason"] or "не указана", "ban_until": num(row["ban_until"])}


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


def admin_check():
    if g.user["tg_id"] not in ADMIN_IDS:
        return jsonify(error="Нет доступа"), 403
    if not hmac.compare_digest(request.headers.get("X-Admin-Password", ""), ADMIN_PASSWORD):
        return jsonify(error="Неверный пароль"), 403
    return None


def online_count():
    t = now()
    for k in [k for k, v in ONLINE.items() if t - v > ONLINE_TTL]:
        ONLINE.pop(k, None)
    return len(ONLINE)


@app.get("/api/ping")
def api_ping():
    return jsonify(ok=True, time=now())


@app.post("/api/auth")
@auth(allow_unregistered=True, allow_banned=True)
def api_auth():
    if g.user is not None:
        if g.user["is_banned"]:
            return jsonify({"registered": True, **ban_payload(g.user)})
        return jsonify(registered=True, banned=False, user=public_user(g.user, db()))

    body = request.get_json(silent=True) or {}
    nickname = str(body.get("nickname", "")).strip()
    game_id = str(body.get("game_id", "")).strip()
    if not nickname and not game_id:
        return jsonify(registered=False)
    if not re.fullmatch(r"[A-Za-z0-9_\-А-Яа-яЁё]{3,20}", nickname):
        return jsonify(error="Ник: 3–20 символов, буквы, цифры, _ и -"), 400
    if not re.fullmatch(r"\d{4,12}", game_id):
        return jsonify(error="ID CounterFlame: от 4 до 12 цифр"), 400
    with LOCK:
        if db().execute("SELECT 1 FROM users WHERE game_id=?", (game_id,)).fetchone():
            return jsonify(error="Этот ID CounterFlame уже зарегистрирован"), 409
        if db().execute("SELECT 1 FROM users WHERE LOWER(nickname)=LOWER(?)", (nickname,)).fetchone():
            return jsonify(error="Этот ник уже занят"), 409
        db().execute(
            "INSERT INTO users (tg_id, nickname, game_id, created_at) VALUES (?,?,?,?)",
            (g.tg["id"], nickname, game_id, now()),
        )
        db().commit()
    return jsonify(registered=True, banned=False, user=public_user(load_user(g.tg["id"]), db()))


@app.get("/api/profile")
@auth()
def api_profile():
    return jsonify(user=public_user(g.user, db()))


@app.get("/api/online")
@auth()
def api_online():
    in_lobbies = db().execute(
        "SELECT COUNT(DISTINCT lp.tg_id) FROM lobby_players lp JOIN lobbies l ON l.id=lp.lobby_id "
        "WHERE l.status IN ('open','confirming','playing','review')"
    ).fetchone()[0]
    return jsonify(online=online_count(), in_lobbies=in_lobbies)


@app.get("/api/leaderboard")
@auth()
def api_leaderboard():
    rows = db().execute(
        "SELECT * FROM users WHERE is_banned=0 ORDER BY points DESC, elo DESC, id ASC LIMIT 20"
    ).fetchall()
    return jsonify(players=[
        {**card_user(r), "elo": r["elo"], "kd": r["kd"], "points": num(r["points"]), "matches": num(r["matches_played"]),
         "wins": num(r["wins"]), "winrate": winrate(r), "place": i + 1, "me": r["tg_id"] == g.user["tg_id"]}
        for i, r in enumerate(rows)
    ])


def is_member(lobby_id, uid):
    return db().execute("SELECT 1 FROM lobby_players WHERE lobby_id=? AND tg_id=?", (lobby_id, uid)).fetchone() is not None


def get_lobby(lid, statuses=ACTIVE):
    q = ",".join("?" * len(statuses))
    return db().execute(f"SELECT * FROM lobbies WHERE id=? AND status IN ({q})", (lid, *statuses)).fetchone()


def nickname_of(con, tg_id):
    r = con.execute("SELECT nickname FROM users WHERE tg_id=?", (tg_id,)).fetchone()
    return r["nickname"] if r else "Игрок"


def member_rows(con, lid):
    return con.execute(
        "SELECT lp.tg_id, lp.team, lp.confirmed, u.id, u.nickname, u.badges, u.plan, u.plan_until, u.verified, u.avatar, u.banner "
        "FROM lobby_players lp JOIN users u ON u.tg_id=lp.tg_id WHERE lp.lobby_id=? ORDER BY lp.rowid", (lid,)).fetchall()


def sync_players(con, lid):
    n = con.execute("SELECT COUNT(*) FROM lobby_players WHERE lobby_id=?", (lid,)).fetchone()[0]
    con.execute("UPDATE lobbies SET players=? WHERE id=?", (n, lid))
    return n


def lobby_dict(con, r, uid):
    counts = {"KT": 0, "T": 0}
    confirmed = 0
    for m in member_rows(con, r["id"]):
        counts[m["team"] if m["team"] in counts else "KT"] += 1
        confirmed += 1 if m["confirmed"] else 0
    return {
        "id": r["id"], "map": r["map"], "mode": r["mode"], "players": r["players"],
        "max_players": r["max_players"], "status": r["status"], "created_at": r["created_at"],
        "mine": is_member(r["id"], uid), "owner": nickname_of(con, r["owner_tg_id"]),
        "counts": counts, "confirmed": confirmed,
    }


def lobby_result(con, r):
    m = con.execute("SELECT * FROM matches WHERE lobby_id=? ORDER BY id DESC LIMIT 1", (r["id"],)).fetchone()
    if not m or not m["applied"]:
        return None
    rows = con.execute("SELECT * FROM match_results WHERE match_id=? ORDER BY won DESC, kills DESC", (m["id"],)).fetchall()
    return {
        "winner": m["winner"],
        "players": [{"nickname": x["nickname"], "team": x["team"], "won": bool(x["won"]), "kills": x["kills"],
                     "deaths": x["deaths"], "assists": x["assists"], "points_change": x["points_change"],
                     "points_total": x["points_total"]} for x in rows],
    }


def lobby_detail(con, r, uid):
    teams = {"KT": [], "T": []}
    confirmed = 0
    my_confirmed = False
    for x in member_rows(con, r["id"]):
        if x["confirmed"]:
            confirmed += 1
        if x["tg_id"] == uid:
            my_confirmed = bool(x["confirmed"])
        teams[x["team"] if x["team"] in teams else "KT"].append({
            "nickname": x["nickname"], "owner": x["tg_id"] == r["owner_tg_id"],
            "host": r["status"] in ("playing", "review", "finished") and x["tg_id"] == r["host_tg_id"],
            "me": x["tg_id"] == uid, "confirmed": bool(x["confirmed"]),
            "badges": badge_ids(x), "id": x["id"], "verified": bool(x["verified"]), "avatar": x["avatar"] or "",
        })
    d = lobby_dict(con, r, uid)
    started = r["status"] in ("playing", "review", "finished")
    d.update(
        teams=teams, comment=r["comment"] or "", code=r["code"] or "",
        is_host=r["owner_tg_id"] == uid,
        is_match_host=started and r["host_tg_id"] == uid,
        host_name=nickname_of(con, r["host_tg_id"]) if started and r["host_tg_id"] else "",
        confirm_until=r["confirm_until"], confirmed=confirmed, my_confirmed=my_confirmed,
        started_at=r["started_at"], server_time=now(),
        result=lobby_result(con, r) if r["status"] == "finished" else None,
    )
    return d


def active_lobby_row(con, uid):
    return con.execute(
        "SELECT l.* FROM lobbies l JOIN lobby_players p ON p.lobby_id=l.id WHERE p.tg_id=? AND "
        "(l.status IN ('open','confirming','playing','review') OR (l.status='finished' AND l.finished_at>?)) "
        "ORDER BY l.id DESC LIMIT 1", (uid, now() - FINISHED_KEEP)).fetchone()


def dm_lobby(con, lid, text, skip=None):
    for m in member_rows(con, lid):
        if m["tg_id"] != skip:
            send_user(m["tg_id"], text)


def begin_confirmation(con, l, auto_confirm=None):
    t = now()
    con.execute("UPDATE lobbies SET status='confirming', confirm_until=? WHERE id=?", (t + CONFIRM_SECONDS, l["id"]))
    con.execute("UPDATE lobby_players SET confirmed=0 WHERE lobby_id=?", (l["id"],))
    if auto_confirm:
        con.execute("UPDATE lobby_players SET confirmed=1 WHERE lobby_id=? AND tg_id=?", (l["id"], auto_confirm))
    con.commit()
    dm_lobby(con, l["id"], (
        "⚔️ <b>ПОДТВЕРЖДЕНИЕ УЧАСТИЯ В МАТЧЕ</b>\n"
        f"{html.escape(l['map'])} · {html.escape(l['mode'])}\n\n"
        f"Откройте приложение и нажмите «Подтвердить» в течение {CONFIRM_SECONDS} сек. "
        "Не подтвердившие игроки будут удалены из лобби."), skip=auto_confirm)
    check_all_confirmed(con, l["id"])


def check_all_confirmed(con, lid):
    l = con.execute("SELECT * FROM lobbies WHERE id=?", (lid,)).fetchone()
    if not l or l["status"] != "confirming":
        return False
    rows = member_rows(con, lid)
    if rows and all(r["confirmed"] for r in rows):
        begin_match(con, l, rows)
        return True
    return False


def begin_match(con, l, rows):
    t = now()
    host = random.choice(rows)
    cur = con.execute("UPDATE lobbies SET status='playing', started_at=?, host_tg_id=?, confirm_until=0 WHERE id=? AND status='confirming'",
                      (t, host["tg_id"], l["id"]))
    if cur.rowcount == 0:
        return
    mc = con.execute("INSERT INTO matches (lobby_id, map, mode, started_at) VALUES (?,?,?,?)", (l["id"], l["map"], l["mode"], t))
    for r in rows:
        con.execute("INSERT INTO match_results (match_id, tg_id, nickname, team) VALUES (?,?,?,?)",
                    (mc.lastrowid, r["tg_id"], r["nickname"], r["team"]))
    con.commit()
    head = f"✅ <b>Ваш матч начался!</b>\n{html.escape(l['map'])} · {html.escape(l['mode'])}\n\n"
    for r in rows:
        if r["tg_id"] == host["tg_id"]:
            send_user(r["tg_id"], head + "🎯 Вас выбрали хостером. Создайте игру и отправьте код лобби в приложении — он придёт всем игрокам.")
        else:
            send_user(r["tg_id"], head + f"Дождитесь хостера ({host['nickname']}) — он скинет код.")
    send_channel_message(f"Матч начался: {nickname_of(con, l['owner_tg_id'])}\n{l['map']} · {l['mode']} · {len(rows)}/{l['max_players']}")


def expire_confirmation(con, l):
    rows = member_rows(con, l["id"])
    missing = [r for r in rows if not r["confirmed"]]
    for r in missing:
        con.execute("DELETE FROM lobby_players WHERE lobby_id=? AND tg_id=?", (l["id"], r["tg_id"]))
        send_user(r["tg_id"], "⏱ Вы не подтвердили участие в матче и были удалены из лобби.")
    left = sync_players(con, l["id"])
    if left == 0:
        con.execute("UPDATE lobbies SET status='closed' WHERE id=?", (l["id"],))
    else:
        owner = l["owner_tg_id"]
        if not con.execute("SELECT 1 FROM lobby_players WHERE lobby_id=? AND tg_id=?", (l["id"], owner)).fetchone():
            owner = con.execute("SELECT tg_id FROM lobby_players WHERE lobby_id=? ORDER BY rowid LIMIT 1", (l["id"],)).fetchone()["tg_id"]
        con.execute("UPDATE lobbies SET status='open', confirm_until=0, owner_tg_id=? WHERE id=?", (owner, l["id"]))
        con.execute("UPDATE lobby_players SET confirmed=0 WHERE lobby_id=?", (l["id"],))
        dm_lobby(con, l["id"], "ℹ️ Не все игроки подтвердили участие. Лобби снова в наборе игроков.")
    con.commit()


def tick(con):
    t = now()
    con.execute("UPDATE lobbies SET status='closed' WHERE (status='open' AND created_at<?) OR (status IN ('playing','review') AND started_at<?)",
                (t - LOBBY_TTL, t - PLAYING_TTL))
    con.commit()
    for l in con.execute("SELECT * FROM lobbies WHERE status='confirming'").fetchall():
        if check_all_confirmed(con, l["id"]):
            continue
        if l["confirm_until"] and l["confirm_until"] <= t:
            expire_confirmation(con, l)


def worker_loop():
    while True:
        time.sleep(2)
        try:
            with LOCK:
                con = connect()
                try:
                    tick(con)
                finally:
                    con.close()
        except Exception as e:
            app.logger.warning("tick failed: %s", type(e).__name__)


def leave_lobby(con, l, uid):
    is_owner = l["owner_tg_id"] == uid
    status = l["status"]
    if status == "finished":
        con.execute("DELETE FROM lobby_players WHERE lobby_id=? AND tg_id=?", (l["id"], uid))
        con.commit()
        return False
    if status in ("open", "confirming") and is_owner:
        con.execute("UPDATE lobbies SET status='closed' WHERE id=?", (l["id"],))
        if status == "confirming":
            dm_lobby(con, l["id"], "ℹ️ Хост закрыл лобби, матч отменён.", skip=uid)
        con.commit()
        return True
    con.execute("DELETE FROM lobby_players WHERE lobby_id=? AND tg_id=?", (l["id"], uid))
    left = sync_players(con, l["id"])
    if left == 0:
        con.execute("UPDATE lobbies SET status='closed' WHERE id=?", (l["id"],))
        con.commit()
        return True
    if status == "confirming":
        con.execute("UPDATE lobbies SET status='open', confirm_until=0 WHERE id=?", (l["id"],))
        con.execute("UPDATE lobby_players SET confirmed=0 WHERE lobby_id=?", (l["id"],))
        dm_lobby(con, l["id"], "ℹ️ Один из игроков вышел. Лобби снова в наборе игроков.")
    elif status in ("playing", "review"):
        rest = [r["tg_id"] for r in member_rows(con, l["id"])]
        if l["host_tg_id"] == uid:
            new_host = random.choice(rest)
            con.execute("UPDATE lobbies SET host_tg_id=?, code='' WHERE id=?", (new_host, l["id"]))
            send_user(new_host, "🎯 Прежний хостер вышел, теперь хостер — вы. Отправьте код лобби игрокам в приложении.")
        if is_owner:
            con.execute("UPDATE lobbies SET owner_tg_id=? WHERE id=?", (rest[0], l["id"]))
    con.commit()
    return False


@app.get("/api/my_lobby")
@auth()
def api_my_lobby():
    uid = g.user["tg_id"]
    with LOCK:
        tick(db())
        r = active_lobby_row(db(), uid)
        detail = lobby_detail(db(), r, uid) if r else None
    return jsonify(lobby=detail, online=online_count(), server_time=now())


@app.route("/api/lobbies", methods=["GET", "POST"])
@auth()
def api_lobbies():
    t = now()
    uid = g.user["tg_id"]
    con = db()

    if request.method == "GET":
        with LOCK:
            tick(con)
            lid = request.args.get("id", type=int)
            if lid:
                r = get_lobby(lid, ACTIVE + ("finished",))
                if not r:
                    return jsonify(error="Лобби не найдено или уже закрыто"), 404
                if not is_member(lid, uid):
                    return jsonify(error="Вы не участник этого лобби"), 403
                return jsonify(lobby=lobby_detail(con, r, uid))
            rows = con.execute(
                "SELECT * FROM lobbies WHERE status IN ('open','confirming','playing','review') ORDER BY created_at DESC LIMIT 50").fetchall()
            return jsonify(lobbies=[lobby_dict(con, r, uid) for r in rows], online=online_count(), server_time=t)

    body = request.get_json(silent=True) or {}
    action = body.get("action", "create")
    team = body.get("team") if body.get("team") in TEAMS else None

    if action in ("create", "join") and g.user["is_muted"]:
        return jsonify(error="Вы заглушены и не можете создавать или входить в лобби"), 403

    with LOCK:
        tick(con)

        if action in ("create", "join"):
            current = active_lobby_row(con, uid)
            if current is not None and current["status"] == "finished":
                con.execute("DELETE FROM lobby_players WHERE lobby_id=? AND tg_id=?", (current["id"], uid))
                con.commit()
                current = None
            if current is not None and not (action == "join" and current["id"] == body.get("id")):
                return jsonify(error="Вы уже в другом лобби", id=current["id"]), 409

        if action == "create":
            map_name, mode = body.get("map"), body.get("mode")
            if map_name not in MAPS or mode not in MODES:
                return jsonify(error="Неверная карта или режим"), 400
            cur = con.execute(
                "INSERT INTO lobbies (owner_tg_id, map, mode, max_players, players, status, created_at) VALUES (?,?,?,?,?,?,?)",
                (uid, map_name, mode, MODES[mode], 1, "open", t))
            con.execute("INSERT INTO lobby_players (lobby_id, tg_id, team, joined_at) VALUES (?,?,?,?)",
                        (cur.lastrowid, uid, team or "KT", t))
            con.commit()
            send_channel_message(f"Новое лобби: {g.user['nickname']}\n{map_name} · {mode} · 1/{MODES[mode]}")
            return jsonify(ok=True, id=cur.lastrowid)

        r = get_lobby(body.get("id"), ACTIVE + (("finished",) if action == "leave" else ()))
        if not r:
            return jsonify(error="Лобби не найдено или уже закрыто"), 404
        is_owner = r["owner_tg_id"] == uid
        is_match_host = r["status"] in ("playing", "review") and r["host_tg_id"] == uid

        if action == "join":
            if r["status"] != "open":
                return jsonify(error="Матч уже начался"), 409
            if is_member(r["id"], uid):
                return jsonify(error="Вы уже в этом лобби"), 409
            if team is None:
                counts = {tm: con.execute("SELECT COUNT(*) FROM lobby_players WHERE lobby_id=? AND team=?", (r["id"], tm)).fetchone()[0] for tm in TEAMS}
                free = [tm for tm in TEAMS if counts[tm] < r["max_players"] // 2]
                if not free:
                    return jsonify(error="Лобби заполнено"), 409
                team = min(free, key=lambda tm: counts[tm])
            in_team = con.execute("SELECT COUNT(*) FROM lobby_players WHERE lobby_id=? AND team=?", (r["id"], team)).fetchone()[0]
            if in_team >= r["max_players"] // 2:
                return jsonify(error=f"Команда {team} заполнена"), 409
            con.execute("INSERT INTO lobby_players (lobby_id, tg_id, team, joined_at) VALUES (?,?,?,?)", (r["id"], uid, team, t))
            players = sync_players(con, r["id"])
            con.commit()
            if players == 2:
                send_channel_message(
                    f"Новый матч: {nickname_of(con, r['owner_tg_id'])} vs {g.user['nickname']}\n"
                    f"{r['map']} · {r['mode']} · {players}/{r['max_players']}")
            if players >= r["max_players"]:
                begin_confirmation(con, get_lobby(r["id"]))
            return jsonify(ok=True, team=team)

        if not is_member(r["id"], uid):
            return jsonify(error="Вы не участник этого лобби"), 403

        if action == "leave":
            closed = leave_lobby(con, r, uid)
            return jsonify(ok=True, closed=closed)

        if action == "confirm":
            if r["status"] != "confirming":
                return jsonify(error="Подтверждение сейчас не требуется"), 409
            con.execute("UPDATE lobby_players SET confirmed=1 WHERE lobby_id=? AND tg_id=?", (r["id"], uid))
            con.commit()
            started = check_all_confirmed(con, r["id"])
            return jsonify(ok=True, started=started)

        if action == "comment":
            if not is_owner:
                return jsonify(error="Это действие доступно только хосту"), 403
            con.execute("UPDATE lobbies SET comment=? WHERE id=?", (str(body.get("comment", "")).strip()[:300], r["id"]))
            con.commit()
            return jsonify(ok=True)

        if action == "code":
            allowed = is_match_host or (is_owner and r["status"] in ("open", "confirming"))
            if not allowed:
                return jsonify(error="Это действие доступно только хосту"), 403
            code = str(body.get("code", "")).strip()
            if not 1 <= len(code) <= 80:
                return jsonify(error="Код: от 1 до 80 символов"), 400
            con.execute("UPDATE lobbies SET code=? WHERE id=?", (code, r["id"]))
            con.commit()
            if is_match_host:
                dm_lobby(con, r["id"], (
                    f"🔑 <b>Код от хостера {html.escape(g.user['nickname'])}</b>\n\n<code>{html.escape(code)}</code>\n\n"
                    f"{html.escape(r['map'])}. Заходите в игру по коду."), skip=uid)
            return jsonify(ok=True)

        if action == "start":
            if not is_owner:
                return jsonify(error="Это действие доступно только хосту"), 403
            if r["status"] != "open":
                return jsonify(error="Матч уже начался"), 409
            if r["players"] < 2:
                return jsonify(error="Для старта нужно минимум 2 игрока"), 400
            begin_confirmation(con, r, auto_confirm=uid)
            return jsonify(ok=True)

        if action == "finish":
            if not (is_owner or is_match_host):
                return jsonify(error="Это действие доступно только хосту"), 403
            if r["status"] != "playing":
                return jsonify(error="Матч не идёт"), 409
            con.execute("UPDATE lobbies SET status='review' WHERE id=?", (r["id"],))
            con.commit()
            send_channel_message(f"Матч завершён: {r['map']} · {r['mode']}. Ожидаем результаты.")
            return jsonify(ok=True)

    return jsonify(error="Неизвестное действие"), 400


@app.post("/api/match/submit")
@auth()
def api_match_submit():
    if "screenshot" not in request.files:
        return jsonify(error="Нет скриншота"), 400
    file = request.files["screenshot"]
    if not file or file.filename == "":
        return jsonify(error="Пустой файл"), 400
    content = file.read()
    if not content:
        return jsonify(error="Пустой файл"), 400
    if len(content) > IMAGE_MAX_BYTES:
        return jsonify(error="Файл слишком большой"), 413

    uid = g.user["tg_id"]
    lobby_id = request.form.get("lobby_id", type=int)
    with LOCK:
        r = get_lobby(lobby_id, ("playing", "review")) if lobby_id else None
        if not r:
            return jsonify(error="Лобби не найдено или уже закрыто"), 404
        if not is_member(r["id"], uid):
            return jsonify(error="Вы не участник этого лобби"), 403
        rows = member_rows(db(), r["id"])
        owner = nickname_of(db(), r["owner_tg_id"])
        teams = {tm: [x["nickname"] for x in rows if x["team"] == tm] for tm in TEAMS}
        names = [x["nickname"] for x in rows]
        match = db().execute("SELECT * FROM matches WHERE lobby_id=? ORDER BY id DESC LIMIT 1", (r["id"],)).fetchone()
        if match:
            snap = db().execute("SELECT nickname, team FROM match_results WHERE match_id=?", (match["id"],)).fetchall()
            if snap:
                names = [x["nickname"] for x in snap]
                teams = {tm: [x["nickname"] for x in snap if x["team"] == tm] for tm in TEAMS}
        caption = (
            f"🎮 Новый результат на проверку!\n"
            f"Лобби: #{r['id']}\n"
            f"Карта: {r['map']} · {r['mode']}\n"
            f"Хост: {owner}\n"
            f"Игроки: {', '.join(names)}\n"
            f"KT: {', '.join(teams['KT'])}\n"
            f"T: {', '.join(teams['T'])}\n\n"
            f"Введите статистику каждого игрока (Киллы, Смерти, Ассисты) в ответном сообщении."
        )
        mimetype = file.mimetype if (file.mimetype or "").startswith("image/") else "image/jpeg"
        if not send_photo_to_admin(file.filename or "result.jpg", content, mimetype, caption):
            return jsonify(error="Не удалось отправить скриншот админу"), 502
        if r["status"] == "playing":
            db().execute("UPDATE lobbies SET status='review' WHERE id=?", (r["id"],))
            db().commit()
    return jsonify(ok=True)


def bot_secret():
    return hashlib.sha256(("bot-result:" + BOT_TOKEN).encode()).hexdigest() if BOT_TOKEN else ""


@app.post("/api/match/result")
def api_match_result():
    secret = bot_secret()
    if not secret:
        return jsonify(error="Сервер не знает токен бота"), 503
    if not hmac.compare_digest(request.headers.get("X-Bot-Secret", ""), secret):
        return jsonify(error="Нет доступа"), 403

    body = request.get_json(silent=True) or {}
    winner = str(body.get("winner", "")).upper()
    try:
        lobby_id = int(body.get("lobby_id"))
    except (TypeError, ValueError):
        return jsonify(error="Не указан номер лобби"), 400
    if winner not in TEAMS:
        return jsonify(error="Победитель: KT или T"), 400
    stats = {}
    for item in body.get("players", []):
        name = str(item.get("nickname", "")).strip().lower()
        try:
            stats[name] = tuple(max(0, int(item.get(k, 0))) for k in ("kills", "deaths", "assists"))
        except (TypeError, ValueError):
            return jsonify(error="Неверная статистика"), 400

    with LOCK:
        con = connect()
        try:
            match = con.execute("SELECT * FROM matches WHERE lobby_id=? ORDER BY id DESC LIMIT 1", (lobby_id,)).fetchone()
            if not match:
                return jsonify(error="Матч этого лобби не найден"), 404
            if match["applied"]:
                return jsonify(error="Результаты этого лобби уже начислены"), 409
            rows = con.execute("SELECT * FROM match_results WHERE match_id=?", (match["id"],)).fetchall()
            matched = set()
            out = []
            t = now()
            for row in rows:
                k, d, a = stats.get(row["nickname"].lower(), (0, 0, 0))
                if row["nickname"].lower() in stats:
                    matched.add(row["nickname"].lower())
                u = con.execute("SELECT * FROM users WHERE tg_id=?", (row["tg_id"],)).fetchone()
                if not u:
                    continue
                won = row["team"] == winner
                delta = POINTS_WIN if won else -POINTS_LOSS
                bonus = 0
                plan = active_plan(u)
                if won and plan:
                    bonus = round(POINTS_WIN * PLAN_BONUS[plan])
                    delta += bonus
                total = max(0, u["points"] + delta)
                delta = total - u["points"]
                kills_t, deaths_t, assists_t = u["kills_total"] + k, u["deaths_total"] + d, u["assists_total"] + a
                played = u["matches_played"] + 1
                con.execute(
                    "UPDATE users SET points=?, matches_played=?, wins=wins+?, kills_total=?, deaths_total=?, assists_total=?, kd=?, avg=? WHERE tg_id=?",
                    (total, played, 1 if won else 0, kills_t, deaths_t, assists_t,
                     round(kills_t / max(1, deaths_t), 2), round(kills_t / played, 1), row["tg_id"]))
                con.execute(
                    "UPDATE match_results SET kills=?, deaths=?, assists=?, won=?, points_change=?, points_total=? WHERE id=?",
                    (k, d, a, 1 if won else 0, delta, total, row["id"]))
                out.append({"nickname": row["nickname"], "team": row["team"], "won": won, "kills": k, "deaths": d,
                            "assists": a, "kd": round(k / d, 2) if d else float(k), "delta": delta, "bonus": bonus,
                            "total": total, "plan": plan})
                send_user(row["tg_id"], (
                    f"🏁 <b>Матч завершён — {'победа' if won else 'поражение'}</b>\n"
                    f"{k}/{d}/{a} · {html.escape(match['map'])}\n\n"
                    f"Поинты: <b>{'+' if delta >= 0 else ''}{delta}</b>"
                    f"{' (бонус подписки +' + str(bonus) + ')' if bonus else ''}\n"
                    f"Всего: <b>{total}</b>"))
            con.execute("UPDATE matches SET winner=?, finished_at=?, applied=1 WHERE id=?", (winner, t, match["id"]))
            con.execute("UPDATE lobbies SET status='finished', finished_at=? WHERE id=?", (t, lobby_id))
            con.commit()
            return jsonify(ok=True, players=out, unmatched=[n for n in stats if n not in matched])
        finally:
            con.close()


@app.get("/api/posts")
@auth()
def api_posts():
    rows = db().execute(
        "SELECT p.*, u.nickname, u.badges, u.plan, u.plan_until, u.verified, u.tg_id AS tg_id FROM posts p "
        "LEFT JOIN users u ON u.tg_id=p.author_tg_id ORDER BY p.pinned DESC, p.created_at DESC LIMIT 40").fetchall()
    return jsonify(posts=[{
        "id": r["id"], "title": r["title"], "body": r["body"], "image": r["image"], "pinned": bool(r["pinned"]),
        "created_at": r["created_at"], "author": r["nickname"] or "CYBERSHOKE",
        "badges": badge_ids(r) if r["nickname"] else [], "verified": bool(r["verified"]) if r["nickname"] else False,
    } for r in rows])


def valid_image_url(value):
    value = str(value or "").strip()
    if not value:
        return ""
    if re.fullmatch(r"/uploads/[a-f0-9]{24}\.(png|jpg|gif|webp)", value):
        return value
    if re.fullmatch(r"https://[^\s\"'<>]{4,500}", value):
        return value
    return None


def sniff_image(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


@app.post("/api/upload")
@auth()
def api_upload():
    purpose = request.form.get("purpose", "banner")
    if purpose == "post":
        denied = admin_check()
        if denied:
            return denied
    elif purpose == "banner":
        if not can_upload_banner(g.user):
            return jsonify(error="Свой баннер доступен с подпиской или статусом VIP"), 403
    else:
        return jsonify(error="Неизвестная цель загрузки"), 400
    f = request.files.get("file")
    if not f:
        return jsonify(error="Файл не выбран"), 400
    data = f.read()
    if not data:
        return jsonify(error="Пустой файл"), 400
    if len(data) > IMAGE_MAX_BYTES:
        return jsonify(error="Файл слишком большой (до 5 МБ)"), 413
    ext = sniff_image(data)
    if not ext:
        return jsonify(error="Нужна картинка: PNG, JPG, GIF или WEBP"), 400
    name = secrets.token_hex(12) + "." + ext
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    with open(os.path.join(UPLOAD_DIR, name), "wb") as out:
        out.write(data)
    db().execute("INSERT INTO uploads (name, tg_id, purpose, created_at) VALUES (?,?,?,?)", (name, g.user["tg_id"], purpose, now()))
    db().commit()
    return jsonify(ok=True, url="/uploads/" + name)


@app.get("/uploads/<name>")
def uploads(name):
    if not re.fullmatch(r"[a-f0-9]{24}\.(png|jpg|gif|webp)", name):
        return jsonify(error="Не найдено"), 404
    resp = send_from_directory(UPLOAD_DIR, name)
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return resp


@app.post("/api/profile/banner")
@auth()
def api_banner():
    value = str((request.get_json(silent=True) or {}).get("banner", "")).strip()
    if value and value.startswith("preset:"):
        if value[7:] not in PRESET_BANNERS:
            return jsonify(error="Такого баннера нет"), 400
    elif value:
        if not can_upload_banner(g.user):
            return jsonify(error="Свой баннер доступен с подпиской или статусом VIP"), 403
        name = value.rsplit("/", 1)[-1]
        owned = db().execute("SELECT 1 FROM uploads WHERE name=? AND tg_id=? AND purpose='banner'", (name, g.user["tg_id"])).fetchone()
        if not valid_image_url(value) or not value.startswith("/uploads/") or not owned:
            return jsonify(error="Баннер не найден"), 400
    db().execute("UPDATE users SET banner=? WHERE tg_id=?", (value, g.user["tg_id"]))
    db().commit()
    return jsonify(ok=True, user=public_user(load_user(g.user["tg_id"]), db()))


def delete_upload(name, tg_id):
    owned = db().execute("SELECT 1 FROM uploads WHERE name=? AND tg_id=?", (name, tg_id)).fetchone()
    if owned:
        db().execute("DELETE FROM uploads WHERE name=?", (name,))
        try:
            os.remove(os.path.join(UPLOAD_DIR, name))
        except OSError:
            pass


@app.post("/api/profile/avatar")
@auth()
def api_avatar():
    uid = g.user["tg_id"]
    old = g.user["avatar"] or ""
    if request.is_json:
        if str((request.get_json(silent=True) or {}).get("avatar", "")) != "":
            return jsonify(error="Загрузите изображение файлом"), 400
        new_value = ""
    else:
        f = request.files.get("file")
        if not f:
            return jsonify(error="Файл не выбран"), 400
        data = f.read()
        if not data:
            return jsonify(error="Пустой файл"), 400
        if len(data) > IMAGE_MAX_BYTES:
            return jsonify(error="Файл слишком большой (до 5 МБ)"), 413
        ext = sniff_image(data)
        if not ext:
            return jsonify(error="Нужна картинка: PNG, JPG, GIF или WEBP"), 400
        name = secrets.token_hex(12) + "." + ext
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        with open(os.path.join(UPLOAD_DIR, name), "wb") as out:
            out.write(data)
        db().execute("INSERT INTO uploads (name, tg_id, purpose, created_at) VALUES (?,?,?,?)", (name, uid, "avatar", now()))
        new_value = "/uploads/" + name
    db().execute("UPDATE users SET avatar=? WHERE tg_id=?", (new_value, uid))
    if old.startswith("/uploads/"):
        delete_upload(old.rsplit("/", 1)[-1], uid)
    db().commit()
    return jsonify(ok=True, user=public_user(load_user(uid), db()))


@app.get("/api/player/<int:player_id>")
@auth()
def api_player(player_id):
    con = db()
    row = con.execute("SELECT * FROM users WHERE id=?", (player_id,)).fetchone()
    if not row:
        return jsonify(error="Игрок не найден"), 404
    data = public_user(row, con)
    for private in ("tg_id", "game_id", "coins", "is_muted", "mute_until", "is_admin", "can_upload_banner"):
        data.pop(private, None)
    recent = con.execute(
        "SELECT mr.won, mr.kills, mr.deaths, mr.assists, mr.points_change, m.map, m.mode, m.finished_at "
        "FROM match_results mr JOIN matches m ON m.id=mr.match_id WHERE mr.tg_id=? AND m.applied=1 "
        "ORDER BY m.finished_at DESC LIMIT 5", (row["tg_id"],)).fetchall()
    data["recent"] = [dict(r) for r in recent]
    data["me"] = row["tg_id"] == g.user["tg_id"]
    return jsonify(player=data)


@app.get("/api/history")
@auth()
def api_history():
    con = db()
    scope = request.args.get("scope", "all")
    limit = min(max(request.args.get("limit", 10, type=int), 1), 30)
    offset = max(request.args.get("offset", 0, type=int), 0)
    uid = g.user["tg_id"]
    if scope == "mine":
        where = "m.applied=1 AND EXISTS (SELECT 1 FROM match_results x WHERE x.match_id=m.id AND x.tg_id=?)"
        args = (uid,)
    else:
        where, args = "m.applied=1", ()
    total = con.execute(f"SELECT COUNT(*) FROM matches m WHERE {where}", args).fetchall()[0][0]
    rows = con.execute(
        f"SELECT m.* FROM matches m WHERE {where} ORDER BY m.finished_at DESC, m.id DESC LIMIT ? OFFSET ?",
        (*args, limit, offset)).fetchall()
    out = []
    for m in rows:
        players = con.execute(
            "SELECT mr.*, u.id AS uid, u.avatar, u.verified FROM match_results mr LEFT JOIN users u ON u.tg_id=mr.tg_id "
            "WHERE mr.match_id=? ORDER BY mr.won DESC, mr.kills DESC", (m["id"],)).fetchall()
        mine = next((x for x in players if x["tg_id"] == uid), None)
        out.append({
            "id": m["id"], "map": m["map"], "mode": m["mode"], "winner": m["winner"],
            "started_at": m["started_at"], "finished_at": m["finished_at"],
            "duration": max(0, num(m["finished_at"]) - num(m["started_at"])),
            "me": {"won": bool(mine["won"]), "points_change": mine["points_change"]} if mine else None,
            "players": [{"id": x["uid"], "nickname": x["nickname"], "team": x["team"], "kills": x["kills"],
                         "deaths": x["deaths"], "assists": x["assists"], "won": bool(x["won"]),
                         "points_change": x["points_change"], "avatar": x["avatar"] or "",
                         "verified": bool(x["verified"]), "me": x["tg_id"] == uid} for x in players],
        })
    return jsonify(matches=out, total=total, offset=offset, server_time=now())


@app.post("/api/notify")
def api_notify():
    u = tg_user()
    if not u or "id" not in u:
        return jsonify(error="Не удалось проверить Telegram-сессию"), 401
    t = now()
    if t - LAST_NOTIFY.get(u["id"], 0) < 3:
        return jsonify(error="Слишком часто"), 429
    LAST_NOTIFY[u["id"]] = t
    b = request.get_json(silent=True) or {}
    try:
        slots = f"{int(b.get('players', 1))}/{int(b.get('max_players', 2))}"
    except (TypeError, ValueError):
        return jsonify(error="Неверные данные"), 400
    info = f"{b.get('map') if b.get('map') in MAPS else '—'} · {b.get('mode') if b.get('mode') in MODES else '—'} · {slots}"
    owner = clean(b.get("owner")) or "Игрок"
    kind = b.get("type")
    if kind == "join":
        text = f"Новый матч: {owner} vs {clean(b.get('joiner')) or 'Игрок'}\n{info}"
    elif kind == "start":
        text = f"Матч начался: {owner}\n{info}"
    else:
        text = f"Новое лобби: {owner}\n{info}"
    send_channel_message(text)
    return jsonify(ok=True)


def admin_row(r):
    t = now()
    return {
        "tg_id": r["tg_id"], "nickname": r["nickname"], "game_id": r["game_id"], "elo": r["elo"], "points": num(r["points"]),
        "is_banned": bool(r["is_banned"] and num(r["ban_until"]) > t), "ban_reason": r["ban_reason"] or "", "ban_until": num(r["ban_until"]),
        "is_muted": bool(r["is_muted"] and num(r["mute_until"]) > t), "mute_until": num(r["mute_until"]),
        "badges": badge_ids(r), "plan": active_plan(r), "plan_until": num(r["plan_until"]) if active_plan(r) else 0,
        "verified": bool(r["verified"]), "avatar": r["avatar"] or "",
    }


@app.post("/api/admin")
@auth()
def api_admin():
    denied = admin_check()
    if denied:
        return denied

    body = request.get_json(silent=True) or {}
    action = body.get("action", "list")
    con = db()

    if action == "ping":
        return jsonify(ok=True)

    if action == "list":
        rows = con.execute("SELECT * FROM users ORDER BY id DESC LIMIT 300").fetchall()
        return jsonify(players=[admin_row(r) for r in rows])

    if action == "stats":
        t = now()
        return jsonify(
            users=con.execute("SELECT COUNT(*) FROM users").fetchone()[0],
            online=online_count(),
            lobbies=con.execute("SELECT COUNT(*) FROM lobbies WHERE status IN ('open','confirming','playing','review')").fetchone()[0],
            matches=con.execute("SELECT COUNT(*) FROM matches").fetchone()[0],
            finished=con.execute("SELECT COUNT(*) FROM matches WHERE applied=1").fetchone()[0],
            posts=con.execute("SELECT COUNT(*) FROM posts").fetchone()[0],
            premium=con.execute("SELECT COUNT(*) FROM users WHERE plan<>'' AND plan_until>?", (t,)).fetchone()[0],
        )

    if action == "channel_test":
        out = []
        for label, topic in (("Активные матчи", TOPIC_MATCHES), ("Новости", TOPIC_NEWS)):
            ok, desc = tg_request("sendMessage", channel_payload(f"Проверка связи: тема «{label}»", topic))
            out.append({"topic": label, "topic_id": topic, "ok": ok, "error": desc})
        return jsonify(results=out)

    if action == "post_create":
        title = str(body.get("title", "")).strip()[:120]
        text = str(body.get("body", "")).strip()[:3000]
        image = valid_image_url(body.get("image"))
        if not title:
            return jsonify(error="Укажите заголовок поста"), 400
        if image is None:
            return jsonify(error="Неверная ссылка на картинку"), 400
        cur = con.execute("INSERT INTO posts (author_tg_id, title, body, image, pinned, created_at) VALUES (?,?,?,?,?,?)",
                          (g.user["tg_id"], title, text, image, 1 if body.get("pinned") else 0, now()))
        con.commit()
        if body.get("notify", True):
            send_channel_post(title, text, image)
        return jsonify(ok=True, id=cur.lastrowid)

    if action in ("post_delete", "post_pin"):
        post = con.execute("SELECT * FROM posts WHERE id=?", (body.get("id"),)).fetchone()
        if not post:
            return jsonify(error="Пост не найден"), 404
        if action == "post_delete":
            con.execute("DELETE FROM posts WHERE id=?", (post["id"],))
        else:
            con.execute("UPDATE posts SET pinned=? WHERE id=?", (0 if post["pinned"] else 1, post["id"]))
        con.commit()
        return jsonify(ok=True)

    target = body.get("tg_id")
    if not con.execute("SELECT 1 FROM users WHERE tg_id=?", (target,)).fetchone():
        return jsonify(error="Игрок не найден"), 404

    if action in ("ban", "mute", "unban", "unmute") and target in ADMIN_IDS:
        return jsonify(error="Нельзя применять наказания к администратору"), 400

    if action in ("ban", "mute"):
        try:
            minutes = int(body.get("minutes", 0))
        except (TypeError, ValueError):
            return jsonify(error="Неверное время"), 400
        until = PERMANENT if minutes <= 0 else now() + minutes * 60
        reason = str(body.get("reason", "")).strip()[:200]
        target_row = con.execute("SELECT nickname FROM users WHERE tg_id=?", (target,)).fetchone()
        nick = target_row["nickname"] if target_row else str(target)
        if action == "ban":
            if not reason:
                return jsonify(error="Укажите причину бана"), 400
            con.execute("UPDATE users SET is_banned=1, ban_reason=?, ban_until=? WHERE tg_id=?", (reason, until, target))
            send_punishment_log(nick, "ban", reason, "CYBERSHOKE", "Навсегда")
        else:
            con.execute("UPDATE users SET is_muted=1, mute_until=? WHERE tg_id=?", (until, target))
            send_punishment_log(nick, "mute", reason or "Не указана", "CYBERSHOKE", "Навсегда")
    elif action == "unban":
        con.execute("UPDATE users SET is_banned=0, ban_reason='', ban_until=0 WHERE tg_id=?", (target,))
    elif action == "unmute":
        con.execute("UPDATE users SET is_muted=0, mute_until=0 WHERE tg_id=?", (target,))
    elif action == "verify_set":
        con.execute("UPDATE users SET verified=? WHERE tg_id=?", (1 if body.get("value") else 0, target))
    elif action in ("badge_add", "badge_remove"):
        badge = body.get("badge")
        if badge not in GRANTABLE_BADGES:
            return jsonify(error="Неизвестный бейдж"), 400
        row = con.execute("SELECT badges FROM users WHERE tg_id=?", (target,)).fetchone()
        have = [b for b in str(row["badges"] or "").split(",") if b]
        if action == "badge_add" and badge not in have:
            have.append(badge)
        if action == "badge_remove":
            have = [b for b in have if b != badge]
        con.execute("UPDATE users SET badges=? WHERE tg_id=?", (",".join(have), target))
    elif action == "plan_set":
        plan = body.get("plan", "")
        if plan not in ("premium", "lite", ""):
            return jsonify(error="Неизвестная подписка"), 400
        try:
            days = int(body.get("days", 30))
        except (TypeError, ValueError):
            return jsonify(error="Неверный срок"), 400
        if plan and not 1 <= days <= 3650:
            return jsonify(error="Срок: от 1 до 3650 дней"), 400
        con.execute("UPDATE users SET plan=?, plan_until=? WHERE tg_id=?", (plan, now() + days * 86400 if plan else 0, target))
        if plan:
            send_user(target, f"⭐ Вам выдана подписка <b>{plan.upper()}</b> на {days} дн.")
    elif action == "points_add":
        try:
            delta = int(body.get("delta", 0))
        except (TypeError, ValueError):
            return jsonify(error="Неверное число"), 400
        if delta == 0 or abs(delta) > 100000:
            return jsonify(error="Введите число от 1 до 100000 (можно со знаком минус)"), 400
        con.execute("UPDATE users SET points=MAX(0, points+?) WHERE tg_id=?", (delta, target))
    else:
        return jsonify(error="Неизвестное действие"), 400
    con.commit()
    return jsonify(ok=True)


@app.get("/")
def index():
    return send_from_directory(DOCS_DIR, "app_v4.html")


@app.get("/<path:name>")
def static_files(name):
    full = os.path.normpath(os.path.join(DOCS_DIR, name))
    if full.startswith(DOCS_DIR + os.sep) and os.path.isfile(full):
        return send_from_directory(DOCS_DIR, name)
    return jsonify(error="Не найдено"), 404


init_db()
threading.Thread(target=worker_loop, daemon=True).start()


# ==================== СИСТЕМА ТИКЕТОВ ====================
print("🔵 Подключаем тикеты...")
try:
    from support_api import init_support_routes
    init_support_routes(app, BOT_TOKEN)
    print("🟢 Модуль тикетов успешно подключен!")
except Exception as e:
    import traceback
    print("🔴 Ошибка подключения тикетов:", e)
    traceback.print_exc()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
