from flask import Flask

from app.core.environment import load_environment


load_environment()

from app.api import register_blueprints
from app.core import register_error_handlers


def create_app():
    flask_app = Flask(__name__)
    register_error_handlers(flask_app)
    register_blueprints(flask_app)
    return flask_app


app = create_app()
