# server/api.py
import time
import secrets
from datetime import datetime, timedelta
from functools import wraps

from flask import Flask, request, jsonify, g

from config import (
    ADMIN_IDS, MAPS, MODES,
    PREMIUM_PRICE_COINS, PREMIUM_DURATION_DAYS,
)
from database import get_conn, init_db
from auth import validate_init_data

app = Flask(__name__)

@app.after_request
def add_cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Telegram-Init-Data, X-Test-Tg-Id"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp

@app.route("/api/<path:_>", methods=["OPTIONS"])
def cors_preflight(_):
    return ("", 204)

def make_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires = (datetime.utcnow() + timedelta(days=7)).isoformat()
    conn = get_conn()
    try:
        conn.execute(
            "INSERT INTO sessions(token, user_id, expires_at) VALUES(?,?,?)",
            (token, user_id, expires),
        )
        conn.commit()
    finally:
        conn.close()
    return token

def public_user(row) -> dict:
    if row is None:
        return None
    return {
        "id": row["id"],
        "tg_id": row["tg_id"],
        "nickname": row["nickname"],
        "game_id": row["game_id"],
        "elo": row["elo"],
        "coins": row["coins"],
        "is_premium": bool(row["is_premium"]),
        "premium_until": row["premium_until"],
        "created_at": row["created_at"],
    }

def require_auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        init_data = request.headers.get("X-Telegram-Init-Data", "")

        # ТЕСТОВЫЙ РЕЖИМ: X-Test-Tg-Id
        test_tg_id = request.headers.get("X-Test-Tg-Id")
        if test_tg_id:
            try:
                tg_id = int(test_tg_id)
                conn = get_conn()
                try:
                    row = conn.execute("SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()
                finally:
                    conn.close()
                if not row:
                    return jsonify({"ok": False, "error": "need_register", "tg_id": tg_id}), 403
                g.user = row
                return f(*args, **kwargs)
            except ValueError:
                return jsonify({"ok": False, "error": "bad_test_id"}), 400

        v = validate_init_data(init_data)
        if not v:
            return jsonify({"ok": False, "error": "invalid_init_data"}), 401
        tg_id = int(v["user"]["id"])
        conn = get_conn()
        try:
            row = conn.execute("SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()
        finally:
            conn.close()
        if not row:
            return jsonify({"ok": False, "error": "need_register", "tg_id": tg_id}), 403
        g.user = row
        g.tg_user = v["user"]
        return f(*args, **kwargs)
    return wrapper

def is_admin(tg_id: int) -> bool:
    return tg_id in ADMIN_IDS

@app.route("/api/health")
def health():
    return jsonify({"ok": True, "ts": int(time.time())})

@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data = request.get_json(silent=True) or {}
    init_data = data.get("init_data", "")

    test_tg_id = request.headers.get("X-Test-Tg-Id")
    if test_tg_id:
        tg_id = int(test_tg_id)
        tg_user = {"id": tg_id, "username": f"test_{tg_id}", "first_name": "Test"}
    else:
        v = validate_init_data(init_data)
        if not v:
            return jsonify({"ok": False, "error": "invalid_init_data"}), 401
        tg_user = v["user"]
        tg_id = int(tg_user["id"])

    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()
        if not row:
            return jsonify({
                "ok": True,
                "need_register": True,
                "tg": {
                    "id": tg_id,
                    "username": tg_user.get("username"),
                    "first_name": tg_user.get("first_name"),
                },
            })
        conn.execute(
            "UPDATE users SET last_login=CURRENT_TIMESTAMP WHERE id=?", (row["id"],)
        )
        conn.commit()
        token = make_session(row["id"])
    finally:
        conn.close()

    return jsonify({
        "ok": True,
        "need_register": False,
        "token": token,
        "user": public_user(row),
        "is_admin": is_admin(tg_id),
    })

@app.route("/api/auth/register", methods=["POST"])
def auth_register():
    data = request.get_json(silent=True) or {}
    init_data = data.get("init_data", "")
    nickname = (data.get("nickname") or "").strip()
    game_id = (data.get("game_id") or "").strip() or None

    if not nickname or len(nickname) > 32:
        return jsonify({"ok": False, "error": "bad_nickname"}), 400

    test_tg_id = request.headers.get("X-Test-Tg-Id")
    if test_tg_id:
        tg_id = int(test_tg_id)
    else:
        v = validate_init_data(init_data)
        if not v:
            return jsonify({"ok": False, "error": "invalid_init_data"}), 401
        tg_id = int(v["user"]["id"])

    conn = get_conn()
    try:
        exists = conn.execute("SELECT id FROM users WHERE tg_id=?", (tg_id,)).fetchone()
        if exists:
            return jsonify({"ok": False, "error": "already_registered"}), 409
        conn.execute(
            "INSERT INTO users(tg_id, nickname, game_id) VALUES(?,?,?)",
            (tg_id, nickname, game_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()
        token = make_session(row["id"])
    finally:
        conn.close()

    return jsonify({
        "ok": True,
        "token": token,
        "user": public_user(row),
        "is_admin": is_admin(tg_id),
    })

@app.route("/api/profile/me")
@require_auth
def profile_me():
    return jsonify({
        "ok": True,
        "user": public_user(g.user),
        "is_admin": is_admin(g.user["tg_id"]),
    })

@app.route("/api/profile/nickname", methods=["POST"])
@require_auth
def profile_nickname():
    data = request.get_json(silent=True) or {}
    nick = (data.get("nickname") or "").strip()
    if not nick or len(nick) > 32:
        return jsonify({"ok": False, "error": "bad_nickname"}), 400
    conn = get_conn()
    try:
        conn.execute("UPDATE users SET nickname=? WHERE id=?", (nick, g.user["id"]))
        conn.commit()
    finally:
        conn.close()
    return jsonify({"ok": True, "nickname": nick})

@app.route("/api/profile/premium/buy", methods=["POST"])
@require_auth
def profile_premium_buy():
    user = g.user
    price = PREMIUM_PRICE_COINS
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT coins, premium_until FROM users WHERE id=?", (user["id"],)
        ).fetchone()
        if row["coins"] < price:
            return jsonify({
                "ok": False,
                "error": "not_enough_coins",
                "need": price, "have": row["coins"],
            }), 402
        base = datetime.utcnow()
        if row["premium_until"]:
            try:
                base = max(base, datetime.fromisoformat(row["premium_until"]))
            except ValueError:
                pass
        until = (base + timedelta(days=PREMIUM_DURATION_DAYS)).isoformat()
        conn.execute(
            "UPDATE users SET coins=coins-?, is_premium=1, premium_until=? WHERE id=?",
            (price, until, user["id"]),
        )
        conn.commit()
    finally:
        conn.close()
    return jsonify({"ok": True, "premium_until": until, "price": price})

@app.route("/api/lobbies")
@require_auth
def lobbies_list():
    conn = get_conn()
    try:
        rows = conn.execute(
            """SELECT l.*, u.nickname AS creator_nickname
               FROM lobbies l JOIN users u ON u.id = l.creator_id
               WHERE l.status='open' ORDER BY l.created_at DESC LIMIT 50"""
        ).fetchall()
        out = []
        for r in rows:
            cnt = conn.execute(
                "SELECT COUNT(*) AS c FROM lobby_members WHERE lobby_id=?", (r["id"],)
            ).fetchone()["c"]
            out.append({
                "id": r["id"], "code": r["code"], "mode": r["mode"], "map": r["map"],
                "max_players": r["max_players"], "status": r["status"],
                "creator": r["creator_nickname"], "players": cnt,
                "created_at": r["created_at"],
            })
    finally:
        conn.close()
    return jsonify({"ok": True, "lobbies": out, "maps": MAPS, "modes": MODES})

@app.route("/api/lobbies", methods=["POST"])
@require_auth
def lobbies_create():
    data = request.get_json(silent=True) or {}
    code = (data.get("code") or "").strip()
    mode = (data.get("mode") or "").strip()
    map_ = (data.get("map") or "").strip()

    if not code or not mode or not map_:
        return jsonify({"ok": False, "error": "missing_fields"}), 400
    if mode not in [m["id"] for m in MODES]:
        return jsonify({"ok": False, "error": "bad_mode"}), 400
    if map_ not in MAPS:
        return jsonify({"ok": False, "error": "bad_map"}), 400

    max_p = next(m["max_players"] for m in MODES if m["id"] == mode)
    conn = get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO lobbies(creator_id, code, mode, map, max_players) VALUES(?,?,?,?,?)",
            (g.user["id"], code, mode, map_, max_p),
        )
        conn.commit()
        lobby_id = cur.lastrowid
        conn.execute(
            "INSERT INTO lobby_members(lobby_id, user_id) VALUES(?,?)",
            (lobby_id, g.user["id"]),
        )
        conn.commit()
    finally:
        conn.close()
    return jsonify({"ok": True, "lobby_id": lobby_id})

@app.route("/api/lobbies/<int:lid>/join", methods=["POST"])
@require_auth
def lobbies_join(lid):
    conn = get_conn()
    try:
        lb = conn.execute("SELECT * FROM lobbies WHERE id=?", (lid,)).fetchone()
        if not lb:
            return jsonify({"ok": False, "error": "not_found"}), 404
        if lb["status"] != "open":
            return jsonify({"ok": False, "error": "not_open"}), 400
        cnt = conn.execute(
            "SELECT COUNT(*) AS c FROM lobby_members WHERE lobby_id=?", (lid,)
        ).fetchone()["c"]
        if cnt >= lb["max_players"]:
            conn.execute("UPDATE lobbies SET status='full' WHERE id=?", (lid,))
            conn.commit()
            return jsonify({"ok": False, "error": "full"}), 409
        try:
            conn.execute(
                "INSERT INTO lobby_members(lobby_id, user_id) VALUES(?,?)",
                (lid, g.user["id"]),
            )
            conn.commit()
        except Exception:
            return jsonify({"ok": False, "error": "already_joined"}), 409
        if cnt + 1 >= lb["max_players"]:
            conn.execute("UPDATE lobbies SET status='full' WHERE id=?", (lid,))
            conn.commit()
    finally:
        conn.close()
    return jsonify({"ok": True})

@app.route("/api/lobbies/<int:lid>/leave", methods=["POST"])
@require_auth
def lobbies_leave(lid):
    conn = get_conn()
    try:
        conn.execute(
            "DELETE FROM lobby_members WHERE lobby_id=? AND user_id=?",
            (lid, g.user["id"]),
        )
        conn.execute(
            "UPDATE lobbies SET status='open' WHERE id=? AND status='full'", (lid,)
        )
        conn.commit()
    finally:
        conn.close()
    return jsonify({"ok": True})


@app.route("/api/player/<nickname>")
@require_auth
def player_profile(nickname):
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM users WHERE nickname=?", (nickname,)).fetchone()
        if not row:
            return jsonify({"ok": False, "error": "not_found"}), 404
        # Считаем статистику (пока просто заглушка, в будущем - из match_players)
        wins = 0
        matches = 0
        return jsonify({
            "ok": True,
            "user": {
                "nickname": row["nickname"],
                "elo": row["elo"],
                "is_premium": bool(row["is_premium"]),
                "game_id": row["game_id"],
                "created_at": row["created_at"],
            }
        })
    finally:
        conn.close()

@app.route("/api/stats/top")
@require_auth
def stats_top():
    conn = get_conn()
    try:
        rows = conn.execute(
            """SELECT nickname, elo, is_premium FROM users
               ORDER BY elo DESC, id ASC LIMIT 50"""
        ).fetchall()
    finally:
        conn.close()
    return jsonify({
        "ok": True,
        "top": [
            {"nickname": r["nickname"], "elo": r["elo"], "is_premium": bool(r["is_premium"])}
            for r in rows
        ],
    })

init_db()

if __name__ == "__main__":
    from config import HOST, PORT
    print(f"🚀 API на http://{HOST}:{PORT}")
    app.run(host=HOST, port=PORT, debug=False)
