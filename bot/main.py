import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from config import BOT_TOKEN

MINIAPP_URL = "https://h7995063-eng.github.io/nevajno/main_v10.html"

bot = telebot.TeleBot(BOT_TOKEN)

@bot.message_handler(commands=["start"])
def cmd_start(message):
    # Бот передает ID в URL (если Telegram не вырежет)
    url = f"{MINIAPP_URL}?tg_id={message.from_user.id}"
    kb = InlineKeyboardMarkup()
    kb.add(InlineKeyboardButton("🎮 Открыть CYBERSHOK", web_app=WebAppInfo(url=url)))
    bot.send_message(
        message.chat.id,
        "⚔️ <b>CYBERSHOK</b>\n\nНажми кнопку ниже, чтобы открыть приложение.",
        parse_mode="HTML",
        reply_markup=kb
    )

if __name__ == "__main__":
    print("🤖 Бот запущен")
    bot.infinity_polling()
