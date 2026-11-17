from flask import request, jsonify
import requests

def init_support_routes(app, bot_token):
    @app.route("/api/support", methods=["POST", "OPTIONS"])
    def api_support_clean():
        if request.method == "OPTIONS":
            return jsonify(ok=True), 200
        
        data = request.json or {}
        text = data.get("text", "").strip()
        if not text:
            return jsonify({"ok": False, "error": "Пустой текст"}), 400
            
        tg_id = data.get("tg_id")
        nickname = data.get("nickname", "Игрок")
        username = data.get("username", "")
        
        if not tg_id:
            return jsonify({"ok": False, "error": "Нет TG ID"}), 400

        user_info = f"@{username}" if username else "нет юзернейма"
        
        msg_text = (
            f"🎫 <b>Новый тикет</b>\n\n"
            f"👤 <b>Ник:</b> {nickname}\n"
            f"🔗 <b>Юзер:</b> {user_info}\n"
            f"🆔 <b>TG ID:</b> <code>{tg_id}</code>\n\n"
            f"💬 <b>Сообщение:</b>\n{text}"
        )
        
        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        payload = {
            "chat_id": -1003741583506, 
            "text": msg_text, 
            "parse_mode": "HTML",
            "reply_markup": {
                "inline_keyboard": [
                    [
                        {"text": "✅ Принять", "callback_data": f"accept_{tg_id}"},
                        {"text": "❌ Отклонить", "callback_data": f"reject_{tg_id}"}
                    ]
                ]
            }
        }
        
        try:
            response = requests.post(url, json=payload)
            res_data = response.json()
            if res_data.get("ok"):
                return jsonify({"ok": True, "message": "Тикет отправлен"})
            return jsonify({"ok": False, "error": "Ошибка Telegram API"}), 500
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
