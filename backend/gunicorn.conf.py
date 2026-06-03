import os

# Render / production defaults:
# - one process, multiple threads so /health keep-alive pings are not blocked by long assembly jobs
# - long request timeout for ffmpeg assembly-reel generation
bind = f"0.0.0.0:{os.environ.get('PORT', '5000')}"
timeout = 800
workers = 1
threads = max(2, int(os.environ.get("WEB_CONCURRENCY_THREADS", "4")))
worker_class = "gthread"
keepalive = 5
preload_app = False


def worker_exit(server, worker):
    from app.core.keep_alive import shutdown_keep_alive

    shutdown_keep_alive()
