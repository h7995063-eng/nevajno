# server/auth.py
import hmac
import hashlib
import json
import time
from urllib.parse import parse_qsl
from config import BOT_TOKEN

def validate_init_data(init_data: str, max_age_seconds: int = 86400) -> dict | None:
    """
    Проверяет Telegram WebApp initData через HMAC-SHA256.
    Возвращает dict с данными пользователя или None при ошибке.
    """
    if not init_data:
        return None
    try:
        parsed = dict(parse_qsl(init_data, strict_parsing=True))
    except ValueError:
        return None

    received_hash = parsed.pop("hash", None)
    if not received_hash:
        return None

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(parsed.items()))

    secret_key = hmac.new(
        b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256
    ).digest()
    expected_hash = hmac.new(
        secret_key, data_check_string.encode(), hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected_hash, received_hash):
        return None

    auth_date = int(parsed.get("auth_date", "0"))
    if auth_date and (time.time() - auth_date) > max_age_seconds:
        return None

    user_raw = parsed.get("user")
    if not user_raw:
        return None
    try:
        user = json.loads(user_raw)
    except json.JSONDecodeError:
        return None

    return {"user": user, "auth_date": auth_date, "raw": parsed}
