import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from config import BOT_TOKEN
import re

MINIAPP_URL = "https://h7995063-eng.github.io/nevajno/app_v3.html"
ADMIN_CHAT_ID = -1003741583506

bot = telebot.TeleBot(BOT_TOKEN)

# Хранилище состояний (в памяти): user_id -> данные
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
    # Работаем только в админ-чате
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
        }
        ask_next_player(message)
        return

    # Сценарий 2: админ вводит статистику (уже в процессе опроса)
    if user_id in states:
        state = states[user_id]
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


def ask_next_player(message):
    user_id = message.from_user.id
    state = states.get(user_id)
    if not state:
        return

    idx = state["current"]
    if idx >= len(state["players"]):
        publish_results(message, state)
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
    for player, s in state["stats"].items():
        lines.append(f"{player}: {s['kills']}/{s['deaths']}/{s['assists']} (КД {s['kd']})")

    text = "\n".join(lines)
    bot.reply_to(message, text, parse_mode="HTML")
    states.pop(message.from_user.id, None)


if __name__ == "__main__":
    print("Бот запущен")
    bot.infinity_polling()
