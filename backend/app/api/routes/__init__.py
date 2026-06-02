from .assets import assets_bp
from .game_analysis import game_analysis_bp
from .game_media import game_media_bp
from .game_videos import game_videos_bp
from .game_workspace import game_workspace_bp
from .games import games_bp
from .health import health_bp
from .highlights import highlights_bp
from .ingestions import ingestions_bp
from .knowledge_stores import knowledge_stores_bp
from .responses import responses_bp


def register_blueprints(app):
    app.register_blueprint(health_bp)
    app.register_blueprint(assets_bp)
    app.register_blueprint(games_bp)
    app.register_blueprint(game_videos_bp)
    app.register_blueprint(game_analysis_bp)
    app.register_blueprint(game_workspace_bp)
    app.register_blueprint(game_media_bp)
    app.register_blueprint(knowledge_stores_bp)
    app.register_blueprint(responses_bp)
    app.register_blueprint(highlights_bp)
    app.register_blueprint(ingestions_bp)
