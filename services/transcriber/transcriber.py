#!/usr/bin/env python3
"""
VHF14 Transcriber - Watches for new WAV recordings and transcribes them with Whisper.
Publishes transcription JSON to Redis channel 'transcriptions'.
"""

import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import redis
from faster_whisper import WhisperModel
from watchdog.events import FileSystemEventHandler, FileCreatedEvent
from watchdog.observers import Observer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [transcriber] %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

RECORDINGS_DIR = "/app/recordings"
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base.en")
# How long to wait after file creation before attempting transcription,
# to ensure the recorder has finished writing.
FILE_SETTLE_DELAY = 2.0  # seconds


class RecordingHandler(FileSystemEventHandler):
    """Watchdog event handler that transcribes new WAV files."""

    def __init__(self, model, redis_client):
        super().__init__()
        self.model = model
        self.redis = redis_client
        # Track files already being processed to avoid duplicates
        self._processing: set = set()

    def on_created(self, event: FileCreatedEvent):
        if event.is_directory:
            return
        path = Path(event.src_path)
        if path.suffix.lower() != ".wav":
            return
        if str(path) in self._processing:
            return

        self._processing.add(str(path))
        try:
            self._transcribe(path)
        finally:
            self._processing.discard(str(path))

    def _transcribe(self, path: Path):
        log.info(f"New file detected: {path.name} — waiting {FILE_SETTLE_DELAY}s for write to complete")
        time.sleep(FILE_SETTLE_DELAY)

        if not path.exists():
            log.warning(f"File disappeared before transcription: {path.name}")
            return

        file_size = path.stat().st_size
        if file_size == 0:
            log.warning(f"Skipping empty file: {path.name}")
            return

        log.info(f"Transcribing {path.name} ({file_size / 1024:.1f} KB)...")
        start = time.monotonic()

        try:
            segments, _ = self.model.transcribe(str(path), language="en", beam_size=5)
            text = " ".join(seg.text for seg in segments).strip()
        except Exception as e:
            log.error(f"Whisper transcription failed for {path.name}: {e}")
            return
        elapsed = time.monotonic() - start
        log.info(f"Transcribed {path.name} in {elapsed:.1f}s: {text[:80]!r}{'...' if len(text) > 80 else ''}")

        if not text:
            log.info(f"Empty transcription for {path.name}, skipping publish")
            return

        message = {
            "id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "file": path.name,
            "text": text,
        }

        try:
            self.redis.publish("transcriptions", json.dumps(message))
            log.info(f"Published transcription id={message['id']} to Redis channel 'transcriptions'")
        except redis.RedisError as e:
            log.error(f"Failed to publish to Redis: {e}")


def wait_for_redis(redis_url: str, retries: int = 30, delay: float = 2.0) -> redis.Redis:
    """Block until Redis is reachable, then return client."""
    for attempt in range(1, retries + 1):
        try:
            client = redis.from_url(redis_url, decode_responses=True)
            client.ping()
            log.info(f"Connected to Redis at {redis_url}")
            return client
        except (redis.ConnectionError, redis.TimeoutError) as e:
            log.warning(f"Redis not ready (attempt {attempt}/{retries}): {e}")
            if attempt < retries:
                time.sleep(delay)
    log.error("Could not connect to Redis after all retries. Exiting.")
    raise SystemExit(1)


def main():
    log.info(f"VHF14 Transcriber starting")
    log.info(f"Whisper model: {WHISPER_MODEL}")
    log.info(f"Redis URL: {REDIS_URL}")
    log.info(f"Watching directory: {RECORDINGS_DIR}")

    redis_client = wait_for_redis(REDIS_URL)

    log.info(f"Loading Whisper model '{WHISPER_MODEL}'...")
    model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    log.info("Whisper model loaded.")

    recordings_path = Path(RECORDINGS_DIR)
    recordings_path.mkdir(parents=True, exist_ok=True)

    handler = RecordingHandler(model=model, redis_client=redis_client)
    observer = Observer()
    observer.schedule(handler, str(recordings_path), recursive=False)
    observer.start()

    log.info("Watching for new recordings. Press Ctrl+C to stop.")
    try:
        while True:
            time.sleep(1)
            if not observer.is_alive():
                log.error("Watchdog observer died unexpectedly. Exiting.")
                break
    except KeyboardInterrupt:
        log.info("Shutdown requested.")
    finally:
        observer.stop()
        observer.join()
        log.info("Transcriber stopped.")


if __name__ == "__main__":
    main()
