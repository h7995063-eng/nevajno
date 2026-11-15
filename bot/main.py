import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from config import BOT_TOKEN

MINIAPP_URL = "https://h7995063-eng.github.io/nevajno/final_app.html?v=200"

bot = telebot.TeleBot(BOT_TOKEN)


def open_keyboard(user_id):
    kb = InlineKeyboardMarkup()
    kb.add(InlineKeyboardButton("🎮 Открыть CYBERSHOKE", web_app=WebAppInfo(url=f"{MINIAPP_URL}&tg_id={user_id}")))
    return kb


@bot.message_handler(commands=["start", "play"])
def cmd_start(message):
    bot.send_message(
        message.chat.id,
        "⚔️ <b>CYBERSHOKE CounterFlame</b>\n\nСоздавай лобби, голосуй за карту и играй с живыми людьми. "
        "Когда матч начнётся, я пришлю уведомление и код от хостера.\n\nНажми кнопку ниже, чтобы открыть приложение.",
        parse_mode="HTML",
        reply_markup=open_keyboard(message.from_user.id),
    )


if __name__ == "__main__":
    print("Бот запущен")
    bot.infinity_polling()
