# bot/main.py
import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from config import BOT_TOKEN

# URL Mini App — плейсхолдер, поменяем после Cloudflare Tunnel
MINIAPP_URL = "https://example.com"

bot = telebot.TeleBot(BOT_TOKEN)

@bot.message_handler(commands=["start"])
def cmd_start(message):
    kb = InlineKeyboardMarkup()
    kb.add(InlineKeyboardButton(
        "🎮 Открыть CYBERSHOK",
        web_app=WebAppInfo(url=MINIAPP_URL)
    ))
    bot.send_message(
        message.chat.id,
        "⚔️ <b>CYBERSHOK</b> × <b>CounterFlame</b>\n\n"
        "Нажми кнопку ниже, чтобы открыть приложение.",
        parse_mode="HTML",
        reply_markup=kb
    )

if __name__ == "__main__":
    print("🤖 Бот запущен (polling)")
    bot.infinity_polling()
