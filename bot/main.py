import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from config import BOT_TOKEN
import re
import json
import requests

MINIAPP_URL = "https://h7995063-eng.github.io/nevajno/app_v8.html"
API_URL = "https://instructors-built-mate-drain.trycloudflare.com"
ADMIN_CHAT_ID = -1003741583506

bot = telebot.TeleBot(BOT_TOKEN)
states = {}


def open_keyboard(user_id):
    kb = InlineKeyboardMarkup()
    kb.add(InlineKeyboardButton("🎮 Открыть CYBERSHOKE", web_app=WebAppInfo(url=f"{MINIAPP_URL}?tg_id={user_id}")))
    return kb


@bot.message_handler(commands=["start", "play"])
def cmd_start(message):
    bot.send_message(
        message.chat.id,
        "⚔️ <b>CYBERSHOKE CounterFlame</b>\nНажми кнопку ниже, чтобы открыть приложение.",
        parse_mode="HTML",
        reply_markup=open_keyboard(message.from_user.id),
    )


@bot.message_handler(content_types=["text"])
def handle_text(message):
    if message.chat.id != ADMIN_CHAT_ID:
        return
    user_id = message.from_user.id
    text = message.text.strip()

    # Сценарий 1: ответ на фото (скриншот) — начинаем опрос
    if message.reply_to_message and message.reply_to_message.photo:
        caption = message.reply_to_message.caption or ""
        print(f"[DEBUG CAPTION] {caption}", flush=True)
        players = []
        match = re.search(r"Игроки: ([^\n]+)", caption)
        if match:
            players = [p.strip() for p in match.group(1).split(",") if p.strip()]
        if not players:
            bot.reply_to(message, "Не удалось найти игроков в подписи.")
            return
        states[user_id] = {
            "players": players,
            "current": 0,
            "stats": {},
            "caption": caption,
            "photo_file_id": message.reply_to_message.photo[-1].file_id,
            "stage": "stats",
            "score_kt": 0,
            "score_t": 0,
        }
        ask_next_player(message)
        return

    state = states.get(user_id)
    if not state:
        return

    # Сценарий 2: ввод статистики
    if state["stage"] == "stats":
        parts = text.split()
        if len(parts) != 3:
            bot.reply_to(message, "Ошибка: введите три числа (Киллы, Смерти, Ассисты).")
            return
        try:
            kills, deaths, assists = map(int, parts)
        except ValueError:
            bot.reply_to(message, "Ошибка: введите числа.")
            return
        player = state["players"][state["current"]]
        kd = kills / deaths if deaths > 0 else kills
        state["stats"][player] = {"kills": kills, "deaths": deaths, "assists": assists, "kd": round(kd, 2)}
        state["current"] += 1
        ask_next_player(message)
        return

    # Сценарий 3: ввод счёта KT
    if state["stage"] == "score_kt":
        try:
            state["score_kt"] = int(text)
        except ValueError:
            bot.reply_to(message, "Ошибка: введите число (счёт KT).")
            return
        state["stage"] = "score_t"
        bot.reply_to(message, "Введите счёт T:")
        return

    # Сценарий 4: ввод счёта T
    if state["stage"] == "score_t":
        try:
            state["score_t"] = int(text)
        except ValueError:
            bot.reply_to(message, "Ошибка: введите число (счёт T).")
            return
        publish_results(message, state)
        return


def ask_next_player(message):
    user_id = message.from_user.id
    state = states.get(user_id)
    if not state:
        return
    idx = state["current"]
    if idx >= len(state["players"]):
        state["stage"] = "score_kt"
        bot.reply_to(message, "Все игроки опрошены. Введите счёт KT (например, 13):")
        return
    player = state["players"][idx]
    bot.reply_to(
        message,
        f"Введите статистику для <b>{player}</b>:\n"
        f"Киллы, Смерти, Ассисты (через пробел, например: <code>20 15 5</code>)",
        parse_mode="HTML",
    )


def publish_results(message, state):
    score_kt = state["score_kt"]
    score_t = state["score_t"]
    winner = "KT" if score_kt > score_t else "T"
    print(f"[DEBUG SCORE] score_kt={score_kt}, score_t={score_t}, winner={winner}", flush=True)
    print(f"[DEBUG STATS] stats={list(state['stats'].keys())}", flush=True)

    lines = [f"📊 <b>Результаты матча</b>\nСчёт: KT {score_kt} - {score_t} T\nПобедитель: {winner}\n"]
    for player, s in state["stats"].items():
        lines.append(f"{player}: {s['kills']}/{s['deaths']}/{s['assists']} (КД {s['kd']})")
    text = "\n".join(lines)
    bot.reply_to(message, text, parse_mode="HTML")

    # Обновляем поинты (все игроки из state["stats"])
    try:
        headers = {"X-Dev-User": json.dumps({"id": 6999358439, "username": "admin"})}
        # Все игроки из stats — получают поинты
        all_players = list(state["stats"].keys())
        # Победители (по командам из caption)
        kt_players = []
        t_players = []
        match_kt = re.search(r"^KT: ([^\n]+)", state["caption"], re.MULTILINE)
        if match_kt:
            kt_players = [p.strip() for p in match_kt.group(1).split(",") if p.strip()]
        match_t = re.search(r"^T: ([^\n]+)", state["caption"], re.MULTILINE)
        if match_t:
            t_players = [p.strip() for p in match_t.group(1).split(",") if p.strip()]

        print(f"[DEBUG TEAMS] kt_players={kt_players}, t_players={t_players}, all_players={all_players}", flush=True)
        winners = []
        losers = []
        for p in all_players:
            if p in kt_players:
                (winners if winner == "KT" else losers).append(p)
            elif p in t_players:
                (winners if winner == "T" else losers).append(p)
            else:
                losers.append(p)  # если не нашли в командах — считаем проигравшим

        if winners:
            requests.post(f"{API_URL}/api/points/update", json={"nicknames": winners, "points_delta": 20}, headers=headers, timeout=10)
        if losers:
            requests.post(f"{API_URL}/api/points/update", json={"nicknames": losers, "points_delta": -15}, headers=headers, timeout=10)

        # Обновляем КД и АВГ
        for player, s in state["stats"].items():
            kd = s["kills"] / s["deaths"] if s["deaths"] > 0 else s["kills"]
            requests.post(f"{API_URL}/api/stats/update", json={"nickname": player, "kd": round(kd, 2), "avg": 0}, headers=headers, timeout=10)

        bot.reply_to(message, "✅ Поинты и статистика обновлены в базе.")
    except Exception as e:
        bot.reply_to(message, f"⚠️ Ошибка обновления: {e}")

    # Публикуем в паблик-чат
    try:
        if state.get("photo_file_id"):
            bot.send_photo(chat_id=-1004336512603, message_thread_id=23, photo=state["photo_file_id"], caption=text, parse_mode="HTML")
        else:
            bot.send_message(chat_id=-1004336512603, message_thread_id=23, text=text, parse_mode="HTML")
    except Exception as e:
        bot.reply_to(message, f"❌ Ошибка публикации: {e}")

    states.pop(message.from_user.id, None)


if __name__ == "__main__":
    print("Бот запущен")
    bot.infinity_polling()
