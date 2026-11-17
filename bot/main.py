import os
import re
import json
import hashlib
import urllib.request
import urllib.error
import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from config import BOT_TOKEN, SERVER_URL

import os
TUNNEL_URL = open(os.path.expanduser("~/cybershoke/.tunnel_url")).read().strip() if os.path.exists(os.path.expanduser("~/cybershoke/.tunnel_url")) else ""
MINIAPP_URL = "https://h7995063-eng.github.io/nevajno/app_v4.html"
ADMIN_CHAT_ID = -1003741583506
TUNNEL_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".tunnel_url")

bot = telebot.TeleBot(BOT_TOKEN)

states = {}


def tunnel_url():
    url = os.environ.get("API_URL", "").strip()
    if not url:
        try:
            with open(TUNNEL_FILE, encoding="utf-8") as f:
                url = f.read().strip()
        except OSError:
            url = ""
    return url.rstrip("/") if re.fullmatch(r"https?://[^\s]+", url) else ""


def open_keyboard(user_id):
    kb = InlineKeyboardMarkup()
    url = f"{MINIAPP_URL}?v=310&tg_id={user_id}"
    api = tunnel_url()
    if api:
        url += f"&api={api}"
    kb.add(InlineKeyboardButton("🎮 Открыть CYBERSHOKE", web_app=WebAppInfo(url=url)))
    return kb


def apply_results(lobby_id, winner, stats):
    secret = hashlib.sha256(("bot-result:" + BOT_TOKEN).encode()).hexdigest()
    payload = {
        "lobby_id": lobby_id,
        "winner": winner,
        "players": [{"nickname": name, **s} for name, s in stats.items()],
    }
    req = urllib.request.Request(
        SERVER_URL.rstrip("/") + "/api/match/result",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Bot-Secret": secret},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode("utf-8")).get("error", "")
        except Exception:
            detail = ""
        raise RuntimeError(detail or f"сервер ответил {e.code}")
    except Exception as e:
        raise RuntimeError(f"сервер недоступен ({type(e).__name__})")


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

    if message.reply_to_message and message.reply_to_message.photo:
        caption = message.reply_to_message.caption or ""
        players = []
        match = re.search(r"Игроки: ([^\n]+)", caption)
        if match:
            players = [p.strip() for p in match.group(1).split(",") if p.strip()]

        if not players:
            bot.reply_to(message, "Не удалось найти игроков в подписи к скриншоту.")
            return

        lobby_match = re.search(r"Лобби: #(\d+)", caption)
        states[user_id] = {
            "lobby_id": int(lobby_match.group(1)) if lobby_match else None,
            "players": players,
            "current": 0,
            "stats": {},
            "caption": caption,
            "photo_file_id": message.reply_to_message.photo[-1].file_id,
            "stage": "stats",
        }
        ask_next_player(message)
        return

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
    match_kt = re.search(r"KT: ([^\n]+)", caption)
    if match_kt:
        kt_players = [p.strip() for p in match_kt.group(1).split(",") if p.strip()]
    match_t = re.search(r"T: ([^\n]+)", caption)
    if match_t:
        t_players = [p.strip() for p in match_t.group(1).split(",") if p.strip()]

    winner = state.get("winner", "KT")
    awarded = {}
    warning = ""
    if state.get("lobby_id"):
        try:
            result = apply_results(state["lobby_id"], winner, state["stats"])
            awarded = {p["nickname"]: p for p in result.get("players", [])}
            if result.get("unmatched"):
                warning = "\n⚠️ Не найдены в лобби: " + ", ".join(result["unmatched"])
        except RuntimeError as e:
            bot.reply_to(message, f"❌ Не удалось начислить поинты: {e}.\nПроверьте, что сервер запущен, и напишите KT или T ещё раз.")
            return
    else:
        warning = "\n⚠️ В подписи нет номера лобби — поинты в приложении не начислены."

    for player, s in state["stats"].items():
        if player in awarded:
            got = awarded[player]
            is_winner = got["won"]
            points = got["delta"]
            total = f" · всего {got['total']}"
        else:
            is_winner = (winner == "KT") if player in kt_players else (winner == "T")
            points = 20 if is_winner else -15
            total = ""
        points_text = f"+{points} поинтов за победу" if is_winner else f"{points} поинтов за поражение"
        lines.append(f"{player}: {s['kills']}/{s['deaths']}/{s['assists']} (КД {s['kd']}) → {points_text}{total}")

    text = "\n".join(lines)
    bot.reply_to(message, text + warning, parse_mode="HTML")

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



# ==================== ОТВЕТ НА ТИКЕТЫ ====================
import re



# ==================== ОБРАБОТКА ТИКЕТОВ ====================
import re

# Словарь для запоминания активных тикетов
active_tickets = {}

@bot.callback_query_handler(func=lambda call: True)
def handle_ticket_buttons(call):
    # Проверяем только нужный чат
    if call.message.chat.id != -1003741583506:
        return

    action, user_tg_id = call.data.split("_")
    
    if action == "accept":
        active_tickets[call.message.chat.id] = user_tg_id
        bot.answer_callback_query(call.id, "Тикет принят.")
        bot.reply_to(call.message, "✍️ Напишите ваш ответ следующим сообщением в этот чат.")
        
    elif action == "reject":
        active_tickets[call.message.chat.id] = f"reject_{user_tg_id}"
        bot.answer_callback_query(call.id, "Напишите причину отклонения.")
        bot.reply_to(call.message, "⚠️ Напишите причину отклонения следующим сообщением в этот чат.")

@bot.message_handler(content_types=['text'])
def handle_all_messages_telebot(message):
    # Пишем в консоль (чтобы видеть, что бот получает сообщение)
    print(f"📩 Получено сообщение: {message.text} от {message.chat.id}")
    
    # Нас интересует только админ-чат
    if message.chat.id != -1003741583506:
        return
        
    # Проверяем, ждем ли мы ответ на тикет
    if message.chat.id in active_tickets:
        target = active_tickets[message.chat.id]
        del active_tickets[message.chat.id] # Сбрасываем ожидание
        
        if str(target).startswith("reject_"):
            user_id = target.split("_")[1]
            try:
                bot.send_message(int(user_id), f"❌ <b>Ваш тикет отклонен.</b>\n\nПричина: {message.text}", parse_mode="HTML")
                bot.reply_to(message, "✅ Причина отклонения отправлена игроку.")
            except Exception as e:
                bot.reply_to(message, f"❌ Ошибка: {e}")
        else:
            user_id = target
            try:
                bot.send_message(int(user_id), f"💬 <b>Ответ поддержки:</b>\n\n{message.text}", parse_mode="HTML")
                bot.reply_to(message, "✅ Ответ успешно отправлен игроку!")
            except Exception as e:
                bot.reply_to(message, f"❌ Ошибка: {e}")
    else:
        print("⚠️ Бот не ждет ответа на тикет (нет активных кнопок 'Принять')")

# ==================== ЗАПУСК ====================
if __name__ == "__main__":
    print("🚀 Бот запускается...")
    bot.infinity_polling()

# ==================== ОБРАБОТКА ТИКЕТОВ ====================
import re
active_tickets = {}

@bot.callback_query_handler(func=lambda call: True)
def handle_ticket_buttons(call):
    if call.message.chat.id != -1003741583506:
        return
    action, user_tg_id = call.data.split("_")
    if action == "accept":
        active_tickets[call.message.chat.id] = user_tg_id
        bot.answer_callback_query(call.id, "Тикет принят.")
        bot.reply_to(call.message, "✍️ Напишите ваш ответ следующим сообщением в этот чат.")
    elif action == "reject":
        active_tickets[call.message.chat.id] = f"reject_{user_tg_id}"
        bot.answer_callback_query(call.id, "Введите причину отклонения.")
        bot.reply_to(call.message, "⚠️ Напишите причину отклонения следующим сообщением.")

@bot.message_handler(content_types=['text'])
def handle_admin_messages(message):
    if message.chat.id != -1003741583506:
        return
    if message.chat.id in active_tickets:
        target = active_tickets[message.chat.id]
        del active_tickets[message.chat.id]
        if str(target).startswith("reject_"):
            user_id = target.split("_")[1]
            try:
                bot.send_message(int(user_id), f"❌ <b>Ваш тикет отклонен.</b>\n\nПричина: {message.text}", parse_mode="HTML")
                bot.reply_to(message, "✅ Причина отправлена игроку.")
            except Exception as e:
                bot.reply_to(message, f"❌ Ошибка: {e}")
        else:
            user_id = target
            try:
                bot.send_message(int(user_id), f"💬 <b>Ответ поддержки:</b>\n\n{message.text}", parse_mode="HTML")
                bot.reply_to(message, "✅ Ответ успешно отправлен!")
            except Exception as e:
                bot.reply_to(message, f"❌ Ошибка: {e}")

if __name__ == "__main__":
    print("🚀 Бот запускается...")
    bot.infinity_polling()

# ==================== ТИКЕТЫ (БЕЗ REPLY) ====================
import re
active_tickets = {}

@bot.callback_query_handler(func=lambda call: True)
def handle_ticket_buttons(call):
    if call.message.chat.id != -1003741583506:
        return
    action, user_tg_id = call.data.split("_")
    if action == "accept":
        active_tickets[call.message.chat.id] = user_tg_id
        bot.answer_callback_query(call.id, "Тикет принят.")
        bot.reply_to(call.message, "✍️ Напишите ваш ответ следующим сообщением в этот чат.")
    elif action == "reject":
        active_tickets[call.message.chat.id] = f"reject_{user_tg_id}"
        bot.answer_callback_query(call.id, "Введите причину отклонения.")
        bot.reply_to(call.message, "⚠️ Напишите причину отклонения следующим сообщением.")

@bot.message_handler(content_types=['text'])
def handle_admin_messages(message):
    if message.chat.id != -1003741583506:
        return
    if message.chat.id in active_tickets:
        target = active_tickets[message.chat.id]
        del active_tickets[message.chat.id]
        if str(target).startswith("reject_"):
            user_id = target.split("_")[1]
            try:
                bot.send_message(int(user_id), f"❌ <b>Ваш тикет отклонен.</b>\n\nПричина: {message.text}", parse_mode="HTML")
                bot.reply_to(message, "✅ Причина отправлена игроку.")
            except Exception as e:
                bot.reply_to(message, f"❌ Ошибка: {e}")
        else:
            user_id = target
            try:
                bot.send_message(int(user_id), f"💬 <b>Ответ поддержки:</b>\n\n{message.text}", parse_mode="HTML")
                bot.reply_to(message, "✅ Ответ успешно отправлен!")
            except Exception as e:
                bot.reply_to(message, f"❌ Ошибка: {e}")
