from app import app
from app.core import register_keep_alive
from app.core.config import port


register_keep_alive(app)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=port())
