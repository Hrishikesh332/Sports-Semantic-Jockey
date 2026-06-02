from flask import Flask

from app.core.environment import load_environment


load_environment()

from app.api import register_blueprints
from app.core import register_cors, register_error_handlers


def create_app():
    flask_app = Flask(__name__)
    register_cors(flask_app)
    register_error_handlers(flask_app)
    register_blueprints(flask_app)
    return flask_app


def __getattr__(name):
    if name == "app":
        from wsgi import app as application

        return application
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
