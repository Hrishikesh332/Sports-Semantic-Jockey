from app import create_app
from app.core.config import port
from app.core.keep_alive import register_keep_alive

app = create_app()
register_keep_alive(app)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=port(), threaded=True)
