import atexit
import logging

import requests

from app.core.config import (
    keep_alive_enabled,
    keep_alive_interval_minutes,
    keep_alive_timeout_seconds,
    keep_alive_url,
)


LOGGER = logging.getLogger(__name__)
_scheduler = None
_atexit_registered = False


def _ping_app(url, timeout_seconds):
    try:
        response = requests.get(url, timeout=timeout_seconds)
        LOGGER.info("Keep-alive ping returned HTTP %s from %s", response.status_code, url)
    except requests.RequestException as exc:
        LOGGER.warning("Keep-alive ping failed for %s: %s", url, exc)


def _shutdown_scheduler():
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
    _scheduler = None


def register_keep_alive(app):
    global _atexit_registered
    global _scheduler

    if not keep_alive_enabled():
        app.logger.info("Keep-alive scheduler disabled by KEEP_ALIVE_ENABLED.")
        return None

    url = keep_alive_url()
    if not url:
        app.logger.info("Keep-alive scheduler disabled because APP_URL or KEEP_ALIVE_URL is not set.")
        return None

    if _scheduler and _scheduler.running:
        return _scheduler

    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.interval import IntervalTrigger
    except ImportError:
        app.logger.warning("Keep-alive scheduler requires APScheduler. Install backend requirements.")
        return None

    interval_minutes = keep_alive_interval_minutes()
    timeout_seconds = keep_alive_timeout_seconds()
    scheduler = BackgroundScheduler(daemon=True, timezone="UTC")
    scheduler.add_job(
        _ping_app,
        trigger=IntervalTrigger(minutes=interval_minutes),
        id="app_keep_alive_ping",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        kwargs={"url": url, "timeout_seconds": timeout_seconds},
    )
    scheduler.start()
    _scheduler = scheduler

    if not _atexit_registered:
        atexit.register(_shutdown_scheduler)
        _atexit_registered = True

    app.logger.info("Keep-alive scheduler started for %s every %s minutes.", url, interval_minutes)
    return scheduler
