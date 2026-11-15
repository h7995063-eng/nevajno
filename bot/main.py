import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from config import BOT_TOKEN
import re

MINIAPP_URL = "https://h7995063-eng.github.io/nevajno/app_v3.html"
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

    # Сценарий 1: админ ответил на фото (скриншот) — начинаем опрос
    if message.reply_to_message and message.reply_to_message.photo:
        caption = message.reply_to_message.caption or ""
        players = []
        match = re.search(r"Игроки: (.+)", caption)
        if match:
            players = [p.strip() for p in match.group(1).split(",") if p.strip()]

        if not players:
            bot.reply_to(message, "Не удалось найти игроков в подписи к скриншоту.")
            return

        states[user_id] = {
            "players": players,
            "current": 0,
            "stats": {},
            "caption": caption,
            "photo_file_id": message.reply_to_message.photo[-1].file_id,
            "stage": "stats",
        }
        ask_next_player(message)
        return

    # Сценарий 2: админ вводит статистику
    state = states.get(user_id)
    if not state:
        return

    if state["stage"] == "stats":
        parts = text.split()
        if len(parts) != 3:
            bot.reply_to(message, "Ошибка: введите три числа через пробел (Киллы, Смерти, Ассисты).")
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

    if state["stage"] == "winner":
        if text.upper() not in ("KT", "T"):
            bot.reply_to(message, "Ошибка: напишите KT или T.")
            return
        state["winner"] = text.upper()
        publish_results(message, state)
        return


def ask_next_player(message):
    user_id = message.from_user.id
    state = states.get(user_id)
    if not state:
        return

    idx = state["current"]
    if idx >= len(state["players"]):
        state["stage"] = "winner"
        bot.reply_to(
            message,
            "Все игроки опрошены. Кто победил? Напишите <b>KT</b> или <b>T</b>.",
            parse_mode="HTML",
        )
        return

    player = state["players"][idx]
    bot.reply_to(
        message,
        f"Введите статистику для <b>{player}</b>:\n"
        f"Киллы, Смерти, Ассисты (через пробел, например: <code>20 15 5</code>)",
        parse_mode="HTML",
    )


def publish_results(message, state):
    lines = ["📊 <b>Результаты матча</b>\n"]
    caption = state.get("caption", "")
    kt_players = []
    t_players = []
    match_kt = re.search(r"KT: (.+)", caption)
    if match_kt:
        kt_players = [p.strip() for p in match_kt.group(1).split(",") if p.strip()]
    match_t = re.search(r"T: (.+)", caption)
    if match_t:
        t_players = [p.strip() for p in match_t.group(1).split(",") if p.strip()]

    winner = state.get("winner", "KT")
    for player, s in state["stats"].items():
        if player in kt_players:
            is_winner = winner == "KT"
        else:
            is_winner = winner == "T"
        points = 20 if is_winner else -15
        points_text = f"+{points} поинтов за победу" if is_winner else f"{points} поинтов за поражение"
        lines.append(f"{player}: {s['kills']}/{s['deaths']}/{s['assists']} (КД {s['kd']}) → {points_text}")

    text = "\n".join(lines)
    bot.reply_to(message, text, parse_mode="HTML")

    try:
        if state.get("photo_file_id"):
            bot.send_photo(
                chat_id=-1004336512603,
                message_thread_id=23,
                photo=state["photo_file_id"],
                caption=text,
                parse_mode="HTML",
            )
        else:
            bot.send_message(
                chat_id=-1004336512603,
                message_thread_id=23,
                text=text,
                parse_mode="HTML",
            )
        bot.reply_to(message, "✅ Результат опубликован в паблик-чате (тема «Результаты матчей»).")
    except Exception as e:
        bot.reply_to(message, f"❌ Ошибка публикации в паблик: {e}")

    states.pop(message.from_user.id, None)


if __name__ == "__main__":
    print("Бот запущен")
    bot.infinity_polling()
