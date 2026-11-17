# server/app.py
from api import app

if __name__ == "__main__":
    from config import HOST, PORT
    print(f"🚀 CYBERSHOK API на http://{HOST}:{PORT}")
    app.run(host=HOST, port=PORT, debug=False, threaded=True)
