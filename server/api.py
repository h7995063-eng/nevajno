import os
import re
import json
import time
import hmac
import random
import hashlib
import sqlite3
import threading
import urllib.request
from functools import wraps
from urllib.parse import parse_qsl

from flask import Flask, request, jsonify, g, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "docs")
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "cybershoke.db"))


def load_token():
    token = os.environ.get("BOT_TOKEN", "").strip()
    if token:
        return token
    try:
        with open(os.path.join(BASE_DIR, "bot", "config.py"), encoding="utf-8") as f:
            found = re.search(r"BOT_TOKEN\s*=\s*[\"']([^\"']+)[\"']", f.read())
        return found.group(1).strip() if found else ""
    except OSError:
        return ""


BOT_TOKEN = load_token()
ALLOW_DEV = os.environ.get("ALLOW_DEV", "") == "1" or not BOT_TOKEN
ADMIN_IDS = {int(x) for x in os.environ.get("ADMIN_IDS", "6999358439").split(",") if x.strip().isdigit()}
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "shoke26")

CHANNEL_ID = os.environ.get("CHANNEL_ID", "-1004336512603")
TOPIC_ID = os.environ.get("TOPIC_ID", "")
MINI_APP_URL = os.environ.get("MINI_APP_URL", "")

PERMANENT = 4102444800
ONLINE_TTL = 120
LOBBY_TTL = 1800
MATCH_TTL = 7200
VOTE_SECONDS = 30

MAP_LIST = [
    {"id": "dust2", "name": "Dust 2"},
    {"id": "mirage", "name": "Mirage"},
    {"id": "inferno", "name": "Inferno"},
    {"id": "nuke", "name": "Nuke"},
]
MAP_NAMES = {m["id"]: m["name"] for m in MAP_LIST}
MODES = {"1v1": 2, "2v2": 4, "5v5": 10, "DM": 16}
DEFAULT_GAP = {"1v1": 40, "2v2": 60, "5v5": 75, "DM": 60}

ONLINE = {}
LAST_NOTIFY = {}
LOCK = threading.RLock()

app = Flask(__name__, static_folder=None)

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


def clean(s, n=24):
    return re.sub(r"[^\w\- ]", "", str(s or ""), flags=re.UNICODE).strip()[:n]


def connect():
    con = sqlite3.connect(DB_PATH, timeout=15)
    con.row_factory = sqlite3.Row
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


def add_column(con, table, column, ddl):
    cols = [r[1] for r in con.execute(f"PRAGMA table_info({table})")]
    if column not in cols:
        con.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


def init_db():
    con = connect()
    con.executescript("""
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
        map TEXT NOT NULL DEFAULT '',
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
    CREATE TABLE IF NOT EXISTS lobby_votes (
        lobby_id INTEGER NOT NULL,
        tg_id INTEGER NOT NULL,
        map_id TEXT NOT NULL,
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
    add_column(con, "lobbies", "voting_until", "INTEGER NOT NULL DEFAULT 0")
    add_column(con, "lobbies", "host_tg_id", "INTEGER NOT NULL DEFAULT 0")
    add_column(con, "lobbies", "code", "TEXT NOT NULL DEFAULT ''")
    add_column(con, "lobbies", "final_map", "TEXT NOT NULL DEFAULT ''")
    add_column(con, "lobbies", "started_at", "INTEGER NOT NULL DEFAULT 0")
    add_column(con, "lobby_players", "joined_at", "INTEGER NOT NULL DEFAULT 0")
    con.commit()
    con.close()


def tg_call(method, payload):
    if not BOT_TOKEN:
        return

    def worker():
        try:
            req = urllib.request.Request(
                f"https://api.telegram.org/bot{BOT_TOKEN}/{method}",
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=10).read()
        except Exception as e:
            app.logger.warning("Telegram request failed: %s", type(e).__name__)

    threading.Thread(target=worker, daemon=True).start()


def send_channel_message(text):
    if not CHANNEL_ID:
        return
    payload = {"chat_id": CHANNEL_ID, "text": text}
    if TOPIC_ID.isdigit():
        payload["message_thread_id"] = int(TOPIC_ID)
    if MINI_APP_URL:
        payload["reply_markup"] = {"inline_keyboard": [[{"text": "Открыть CYBERSHOKE", "url": MINI_APP_URL}]]}
    tg_call("sendMessage", payload)


def send_user(tg_id, text):
    payload = {"chat_id": tg_id, "text": text, "parse_mode": "HTML"}
    if MINI_APP_URL.startswith("https://"):
        payload["reply_markup"] = {"inline_keyboard": [[{"text": "Открыть матч", "web_app": {"url": MINI_APP_URL}}]]}
    tg_call("sendMessage", payload)


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
        user = validate_init_data(init_data)
        if user:
            return user
    if ALLOW_DEV:
        try:
            dev = json.loads(request.headers.get("X-Dev-User", ""))
            if isinstance(dev, dict) and str(dev.get("id", "")).isdigit():
                dev["id"] = int(dev["id"])
                return dev
        except Exception:
            pass
    return None


def load_user(tg_id):
    con = db()
    row = con.execute("SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()
    if row is None:
        return None
    t = now()
    if row["is_banned"] and row["ban_until"] <= t:
        con.execute("UPDATE users SET is_banned=0, ban_reason='', ban_until=0 WHERE tg_id=?", (tg_id,))
    if row["is_muted"] and row["mute_until"] <= t:
        con.execute("UPDATE users SET is_muted=0, mute_until=0 WHERE tg_id=?", (tg_id,))
    con.commit()
    return con.execute("SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()


def user_rank(con, row):
    return con.execute(
        "SELECT COUNT(*) FROM users WHERE is_banned=0 AND (elo>? OR (elo=? AND id<?))",
        (row["elo"], row["elo"], row["id"]),
    ).fetchone()[0] + 1


def public_user(row, con=None):
    data = {
        "tg_id": row["tg_id"], "nickname": row["nickname"], "game_id": row["game_id"],
        "elo": row["elo"], "coins": row["coins"], "points": row["points"],
        "kd": row["kd"], "avg": row["avg"],
        "is_muted": bool(row["is_muted"]), "mute_until": row["mute_until"],
        "is_admin": row["tg_id"] in ADMIN_IDS,
    }
    if con is not None:
        data["rank"] = user_rank(con, row)
    return data


def ban_payload(row):
    return {"banned": True, "ban_reason": row["ban_reason"] or "не указана", "ban_until": row["ban_until"]}


def auth(allow_unregistered=False, allow_banned=False):
    def deco(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            u = tg_user()
            if not u or "id" not in u:
                return jsonify(error="Не удалось проверить Telegram-сессию. Откройте приложение через бота"), 401
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


def avg_gap(con, mode):
    rows = con.execute(
        "SELECT MAX(p.joined_at) - MIN(p.joined_at) AS span, COUNT(*) AS n "
        "FROM lobby_players p JOIN lobbies l ON l.id = p.lobby_id "
        "WHERE l.mode=? AND l.status IN ('voting','started') AND l.created_at>? AND p.joined_at>0 "
        "GROUP BY l.id HAVING n>1 ORDER BY l.id DESC LIMIT 30",
        (mode, now() - 7 * 86400),
    ).fetchall()
    gaps = [r["span"] / (r["n"] - 1) for r in rows]
    base = DEFAULT_GAP.get(mode, 60)
    value = (sum(gaps) + base * 3) / (len(gaps) + 3)
    return max(10, min(600, value))


def eta_seconds(con, lobby):
    missing = lobby["max_players"] - lobby["players"]
    if lobby["status"] != "open" or missing <= 0:
        return 0
    return int(missing * avg_gap(con, lobby["mode"]))


def owner_name(con, tg_id):
    r = con.execute("SELECT nickname FROM users WHERE tg_id=?", (tg_id,)).fetchone()
    return r["nickname"] if r else "Игрок"


def active_lobby_id(con, tg_id):
    t = now()
    r = con.execute(
        "SELECT l.id FROM lobbies l JOIN lobby_players p ON p.lobby_id=l.id "
        "WHERE p.tg_id=? AND ((l.status IN ('open','voting') AND l.created_at>?) "
        "OR (l.status='started' AND l.started_at>?)) ORDER BY l.id DESC LIMIT 1",
        (tg_id, t - LOBBY_TTL - VOTE_SECONDS, t - MATCH_TTL),
    ).fetchone()
    return r["id"] if r else None


def lobby_card(con, l, viewer_id):
    return {
        "id": l["id"], "mode": l["mode"], "owner": owner_name(con, l["owner_tg_id"]),
        "players": l["players"], "max_players": l["max_players"], "status": l["status"],
        "created_at": l["created_at"], "eta": eta_seconds(con, l),
        "mine": con.execute("SELECT 1 FROM lobby_players WHERE lobby_id=? AND tg_id=?", (l["id"], viewer_id)).fetchone() is not None,
    }


def lobby_state(con, l, viewer_id):
    rows = con.execute(
        "SELECT u.tg_id, u.nickname, u.elo FROM lobby_players p JOIN users u ON u.tg_id=p.tg_id "
        "WHERE p.lobby_id=? ORDER BY p.joined_at, u.id",
        (l["id"],),
    ).fetchall()
    votes = {m["id"]: 0 for m in MAP_LIST}
    my_vote = ""
    voted = set()
    for v in con.execute("SELECT tg_id, map_id FROM lobby_votes WHERE lobby_id=?", (l["id"],)).fetchall():
        if v["map_id"] in votes:
            votes[v["map_id"]] += 1
        voted.add(v["tg_id"])
        if v["tg_id"] == viewer_id:
            my_vote = v["map_id"]
    started = l["status"] == "started"
    is_host = started and l["host_tg_id"] == viewer_id
    return {
        "id": l["id"], "mode": l["mode"], "status": l["status"],
        "players": l["players"], "max_players": l["max_players"],
        "owner": owner_name(con, l["owner_tg_id"]),
        "created_at": l["created_at"], "voting_until": l["voting_until"],
        "started_at": l["started_at"], "eta": eta_seconds(con, l),
        "final_map": l["final_map"], "final_map_name": MAP_NAMES.get(l["final_map"], ""),
        "host": owner_name(con, l["host_tg_id"]) if started else "",
        "is_host": is_host,
        "code": l["code"] if started else "",
        "votes": votes, "my_vote": my_vote, "maps": MAP_LIST,
        "members": [
            {"nickname": r["nickname"], "elo": r["elo"], "is_me": r["tg_id"] == viewer_id,
             "is_host": started and r["tg_id"] == l["host_tg_id"], "voted": r["tg_id"] in voted}
            for r in rows
        ],
    }


def finalize(con, lobby_id):
    l = con.execute("SELECT * FROM lobbies WHERE id=?", (lobby_id,)).fetchone()
    if not l or l["status"] != "voting":
        return False
    members = [r["tg_id"] for r in con.execute("SELECT tg_id FROM lobby_players WHERE lobby_id=?", (lobby_id,)).fetchall()]
    if not members:
        return False
    counts = {m["id"]: 0 for m in MAP_LIST}
    for v in con.execute("SELECT map_id FROM lobby_votes WHERE lobby_id=?", (lobby_id,)).fetchall():
        if v["map_id"] in counts:
            counts[v["map_id"]] += 1
    top = max(counts.values())
    pool = [m for m, c in counts.items() if c == top]
    chosen = random.choice(pool)
    host = random.choice(members)
    t = now()
    cur = con.execute(
        "UPDATE lobbies SET status='started', final_map=?, map=?, host_tg_id=?, started_at=? WHERE id=? AND status='voting'",
        (chosen, MAP_NAMES[chosen], host, t, lobby_id),
    )
    if cur.rowcount == 0:
        return False
    con.execute("INSERT INTO matches (lobby_id, map, mode, started_at) VALUES (?,?,?,?)", (lobby_id, MAP_NAMES[chosen], l["mode"], t))
    con.commit()
    host_name = owner_name(con, host)
    head = f"⚔️ <b>Ваш матч начался!</b>\nРежим: {l['mode']} · Карта: {MAP_NAMES[chosen]}\n"
    for uid in members:
        if uid == host:
            send_user(uid, head + "\n🎯 Вас выбрали хостером. Создайте игру и отправьте код лобби в мини-аппе — он уйдёт всем игрокам.")
        else:
            send_user(uid, head + f"\nДождитесь хостера ({host_name}) — он скинет код для входа в игру.")
    send_channel_message(f"Матч начался: {l['mode']} · {MAP_NAMES[chosen]} · {len(members)} игроков")
    return True


def tick(con):
    t = now()
    con.execute("UPDATE lobbies SET status='closed' WHERE status='open' AND created_at<?", (t - LOBBY_TTL,))
    con.commit()
    due = con.execute(
        "SELECT l.id FROM lobbies l WHERE l.status='voting' AND (l.voting_until<=? OR "
        "(SELECT COUNT(*) FROM lobby_votes v WHERE v.lobby_id=l.id) >= l.players)",
        (t,),
    ).fetchall()
    for r in due:
        finalize(con, r["id"])


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


@app.get("/api/check")
@auth(allow_unregistered=True, allow_banned=True)
def api_check():
    nickname = request.args.get("nickname", "").strip()
    game_id = request.args.get("game_id", "").strip()
    out = {}
    if nickname:
        out["nickname_free"] = db().execute("SELECT 1 FROM users WHERE LOWER(nickname)=LOWER(?)", (nickname,)).fetchone() is None
    if game_id:
        out["game_id_free"] = db().execute("SELECT 1 FROM users WHERE game_id=?", (game_id,)).fetchone() is None
    return jsonify(out)


@app.get("/api/profile")
@auth()
def api_profile():
    return jsonify(user=public_user(g.user, db()))


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
        "SELECT tg_id, nickname, elo, kd FROM users WHERE is_banned=0 ORDER BY elo DESC, id ASC LIMIT 30"
    ).fetchall()
    return jsonify(players=[
        {"nickname": r["nickname"], "elo": r["elo"], "kd": r["kd"], "is_me": r["tg_id"] == g.user["tg_id"]}
        for r in rows
    ])


@app.route("/api/lobbies", methods=["GET", "POST"])
@auth()
def api_lobbies():
    con = db()
    uid = g.user["tg_id"]

    if request.method == "GET":
        with LOCK:
            tick(con)
            rows = con.execute(
                "SELECT * FROM lobbies WHERE status='open' ORDER BY created_at DESC LIMIT 50"
            ).fetchall()
            mine_id = active_lobby_id(con, uid)
            mine = None
            if mine_id:
                mine = lobby_card(con, con.execute("SELECT * FROM lobbies WHERE id=?", (mine_id,)).fetchone(), uid)
            cards = [lobby_card(con, r, uid) for r in rows]
        return jsonify(lobbies=cards, my_lobby=mine, online=online_count(), maps=MAP_LIST, server_time=now())

    body = request.get_json(silent=True) or {}
    action = body.get("action", "create")
    if g.user["is_muted"]:
        return jsonify(error="Вы заглушены и не можете создавать или входить в лобби"), 403

    with LOCK:
        tick(con)
        current = active_lobby_id(con, uid)
        t = now()

        if action == "create":
            mode = body.get("mode")
            if mode not in MODES:
                return jsonify(error="Неверный режим"), 400
            if current:
                return jsonify(error="Сначала выйдите из текущего лобби", id=current), 409
            cur = con.execute(
                "INSERT INTO lobbies (owner_tg_id, mode, max_players, players, status, created_at) VALUES (?,?,?,?,?,?)",
                (uid, mode, MODES[mode], 1, "open", t),
            )
            con.execute("INSERT INTO lobby_players (lobby_id, tg_id, joined_at) VALUES (?,?,?)", (cur.lastrowid, uid, t))
            con.commit()
            send_channel_message(f"Новое лобби: {g.user['nickname']}\n{mode} · 1/{MODES[mode]}")
            return jsonify(ok=True, id=cur.lastrowid)

        if action == "join":
            try:
                lobby_id = int(body.get("id"))
            except (TypeError, ValueError):
                return jsonify(error="Неверное лобби"), 400
            lobby = con.execute("SELECT * FROM lobbies WHERE id=? AND status='open'", (lobby_id,)).fetchone()
            if not lobby:
                return jsonify(error="Лобби уже закрыто или матч начался"), 404
            if current == lobby_id:
                return jsonify(ok=True, id=lobby_id)
            if current:
                return jsonify(error="Сначала выйдите из текущего лобби", id=current), 409
            players = lobby["players"] + 1
            con.execute("INSERT INTO lobby_players (lobby_id, tg_id, joined_at) VALUES (?,?,?)", (lobby_id, uid, t))
            if players >= lobby["max_players"]:
                con.execute("UPDATE lobbies SET players=?, status='voting', voting_until=? WHERE id=?", (players, t + VOTE_SECONDS, lobby_id))
            else:
                con.execute("UPDATE lobbies SET players=? WHERE id=?", (players, lobby_id))
            con.commit()
            return jsonify(ok=True, id=lobby_id, full=players >= lobby["max_players"])

    return jsonify(error="Неизвестное действие"), 400


def member_lobby(con, lobby_id, uid):
    l = con.execute("SELECT * FROM lobbies WHERE id=?", (lobby_id,)).fetchone()
    if not l:
        return None, (jsonify(error="Лобби не найдено"), 404)
    if not con.execute("SELECT 1 FROM lobby_players WHERE lobby_id=? AND tg_id=?", (lobby_id, uid)).fetchone():
        return None, (jsonify(error="Вы не состоите в этом лобби"), 403)
    return l, None


@app.get("/api/lobby/<int:lobby_id>")
@auth()
def api_lobby(lobby_id):
    con = db()
    uid = g.user["tg_id"]
    with LOCK:
        tick(con)
        l, err = member_lobby(con, lobby_id, uid)
        if err:
            return err
        if l["status"] == "closed":
            return jsonify(error="Лобби закрыто"), 404
        return jsonify(lobby=lobby_state(con, l, uid), server_time=now())


@app.post("/api/lobby/<int:lobby_id>/vote")
@auth()
def api_vote(lobby_id):
    con = db()
    uid = g.user["tg_id"]
    map_id = (request.get_json(silent=True) or {}).get("map")
    if map_id not in MAP_NAMES:
        return jsonify(error="Такой карты нет"), 400
    with LOCK:
        tick(con)
        l, err = member_lobby(con, lobby_id, uid)
        if err:
            return err
        if l["status"] not in ("open", "voting"):
            return jsonify(error="Голосование уже закончено"), 409
        con.execute("INSERT OR REPLACE INTO lobby_votes (lobby_id, tg_id, map_id) VALUES (?,?,?)", (lobby_id, uid, map_id))
        con.commit()
        tick(con)
        l = con.execute("SELECT * FROM lobbies WHERE id=?", (lobby_id,)).fetchone()
        return jsonify(lobby=lobby_state(con, l, uid), server_time=now())


@app.post("/api/lobby/<int:lobby_id>/leave")
@auth()
def api_leave(lobby_id):
    con = db()
    uid = g.user["tg_id"]
    with LOCK:
        l, err = member_lobby(con, lobby_id, uid)
        if err:
            return err
        con.execute("DELETE FROM lobby_players WHERE lobby_id=? AND tg_id=?", (lobby_id, uid))
        if l["status"] in ("open", "voting"):
            con.execute("DELETE FROM lobby_votes WHERE lobby_id=? AND tg_id=?", (lobby_id, uid))
            left = max(0, l["players"] - 1)
            if left == 0:
                con.execute("UPDATE lobbies SET players=0, status='closed' WHERE id=?", (lobby_id,))
            else:
                owner = l["owner_tg_id"]
                if owner == uid:
                    nxt = con.execute(
                        "SELECT tg_id FROM lobby_players WHERE lobby_id=? ORDER BY joined_at LIMIT 1", (lobby_id,)
                    ).fetchone()
                    owner = nxt["tg_id"]
                con.execute(
                    "UPDATE lobbies SET players=?, status='open', voting_until=0, owner_tg_id=? WHERE id=?",
                    (left, owner, lobby_id),
                )
        elif l["status"] == "started":
            rest = [r["tg_id"] for r in con.execute("SELECT tg_id FROM lobby_players WHERE lobby_id=?", (lobby_id,)).fetchall()]
            if not rest:
                con.execute("UPDATE lobbies SET status='closed' WHERE id=?", (lobby_id,))
            elif l["host_tg_id"] == uid:
                new_host = random.choice(rest)
                con.execute("UPDATE lobbies SET host_tg_id=?, code='' WHERE id=?", (new_host, lobby_id))
                send_user(new_host, "🎯 Прежний хостер вышел, теперь хостер — вы. Отправьте код лобби игрокам в мини-аппе.")
        con.commit()
    return jsonify(ok=True)


@app.post("/api/lobby/<int:lobby_id>/code")
@auth()
def api_code(lobby_id):
    con = db()
    uid = g.user["tg_id"]
    code = str((request.get_json(silent=True) or {}).get("code", "")).strip()
    if not re.fullmatch(r"[A-Za-z0-9_\-# ]{3,24}", code):
        return jsonify(error="Код: 3–24 символа, буквы, цифры, - и _"), 400
    with LOCK:
        l, err = member_lobby(con, lobby_id, uid)
        if err:
            return err
        if l["status"] != "started":
            return jsonify(error="Матч ещё не начался"), 409
        if l["host_tg_id"] != uid:
            return jsonify(error="Код отправляет только хостер"), 403
        con.execute("UPDATE lobbies SET code=? WHERE id=?", (code, lobby_id))
        con.commit()
        others = [r["tg_id"] for r in con.execute(
            "SELECT tg_id FROM lobby_players WHERE lobby_id=? AND tg_id<>?", (lobby_id, uid)).fetchall()]
        l = con.execute("SELECT * FROM lobbies WHERE id=?", (lobby_id,)).fetchone()
        state = lobby_state(con, l, uid)
    for other in others:
        send_user(other, f"🔑 <b>Код от хостера {g.user['nickname']}</b>\n\n<code>{code}</code>\n\nКарта: {MAP_NAMES.get(l['final_map'], '')}. Заходите в игру по коду.")
    return jsonify(lobby=state, server_time=now())


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
            db().execute("UPDATE users SET is_banned=1, ban_reason=?, ban_until=? WHERE tg_id=?", (reason, until, target))
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


@app.post("/api/notify")
def api_notify():
    u = tg_user()
    if not u or "id" not in u:
        return jsonify(error="Не удалось проверить Telegram-сессию"), 401
    t = now()
    if t - LAST_NOTIFY.get(u["id"], 0) < 5:
        return jsonify(error="Слишком часто"), 429
    LAST_NOTIFY[u["id"]] = t
    b = request.get_json(silent=True) or {}
    try:
        slots = f"{int(b.get('players', 1))}/{int(b.get('max_players', 2))}"
    except (TypeError, ValueError):
        return jsonify(error="Неверные данные"), 400
    mode = b.get("mode") if b.get("mode") in MODES else "—"
    owner = clean(b.get("owner")) or "Игрок"
    send_channel_message(f"Новое лобби: {owner}\n{mode} · {slots}")
    return jsonify(ok=True)


@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "final_app.html")


@app.get("/<path:filename>")
def static_files(filename):
    return send_from_directory(STATIC_DIR, filename)


init_db()
threading.Thread(target=worker_loop, daemon=True).start()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), threaded=True)
