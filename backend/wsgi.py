from app import app
from app.core.config import port


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=port())
