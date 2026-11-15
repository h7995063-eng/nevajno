import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from config import BOT_TOKEN
import re
import json

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

    # Если админ ответил на сообщение с фото (скриншот)
    if message.reply_to_message and message.reply_to_message.photo:
        # Запрашиваем статистику по игрокам
        caption = message.reply_to_message.caption or ""
        # Извлекаем список игроков из подписи (после "Игроки: ")
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

        # Начинаем опрос первого игрока
        ask_next_player(message)


def ask_next_player(message):
    user_id = message.from_user.id
    state = states.get(user_id)
    if not state:
        return

    idx = state["current"]
    if idx >= len(state["players"]):
        # Все игроки опрошены — считаем КД и публикуем
        publish_results(message, state)
        return

    player = state["players"][idx]
    bot.reply_to(
        message,
        f"Введите статистику для <b>{player}</b>:\n"
        f"Киллы, Смерти, Ассисты (через пробел, например: <code>20 15 5</code>)",
        parse_mode="HTML",
    )


@bot.message_handler(func=lambda msg: msg.chat.id == ADMIN_CHAT_ID and msg.from_user.id in states and msg.reply_to_message is None)
def handle_stats_input(message):
    user_id = message.from_user.id
    state = states.get(user_id)
    if not state:
        return

    text = message.text.strip()
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


def publish_results(message, state):
    # Формируем итоговую таблицу
    lines = ["📊 <b>Результаты матча</b>\n"]
    for player, s in state["stats"].items():
        lines.append(f"{player}: {s['kills']}/{s['deaths']}/{s['assists']} (КД {s['kd']})")

    text = "\n".join(lines)
    bot.reply_to(message, text, parse_mode="HTML")
    # Сбрасываем состояние
    states.pop(message.from_user.id, None)


if __name__ == "__main__":
    print("Бот запущен")
    bot.infinity_polling()
