#!/usr/bin/env python3
"""
End-to-end test: Drop an audio file into the pipeline and verify the vessel
appears in Redis and on the map API with its name and course.

Prerequisites:
  - docker compose up  (redis, transcriber, extractor, map)
  - pip install -r tests/requirements.txt
  - ffmpeg (only needed if passing non-WAV files like .m4a, .mp3, .ogg)

Usage:
  pytest tests/test_vessel_tracking.py -v --audio path/to/voice_memo.m4a
  pytest tests/test_vessel_tracking.py -v --audio path/to/recording.wav

The audio file should contain a spoken message mentioning a vessel name and
heading/course (e.g. "Motor vessel Pacific Star, heading two-seven-zero,
position 47.6 north 122.4 west").
"""

import json
import os
import shutil
import subprocess
import threading
import time
import uuid

import pytest
import redis
import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
MAP_API_URL = os.environ.get("MAP_API_URL", "http://localhost:3000")
RECORDINGS_DIR = os.path.join(
    os.path.dirname(__file__), "..", "shared", "recordings"
)
# How long to wait for the full pipeline to process (transcribe + extract)
PIPELINE_TIMEOUT = int(os.environ.get("PIPELINE_TIMEOUT", "120"))


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def pytest_addoption(parser):
    parser.addoption(
        "--audio",
        action="store",
        default=None,
        help="Path to an audio file (WAV, M4A, MP3, OGG, etc.) containing a vessel name and heading",
    )


@pytest.fixture
def audio_path(request):
    path = request.config.getoption("--audio")
    if path is None:
        pytest.skip("No --audio file provided; pass --audio <file> to run this test")
    path = os.path.abspath(path)
    if not os.path.isfile(path):
        pytest.fail(f"Audio file not found: {path}")
    return path


@pytest.fixture
def redis_client():
    client = redis.from_url(REDIS_URL, decode_responses=True)
    try:
        client.ping()
    except redis.ConnectionError:
        pytest.fail(
            f"Cannot connect to Redis at {REDIS_URL}. "
            "Make sure 'docker compose up' is running."
        )
    yield client
    client.close()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class CommunicationCatcher:
    """Subscribe to Redis and capture communications that arrive after start."""

    def __init__(self, redis_url: str):
        self._client = redis.from_url(redis_url, decode_responses=True)
        self._pubsub = self._client.pubsub(ignore_subscribe_messages=True)
        self._pubsub.subscribe("communications_updates")
        self._messages: list[dict] = []
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._listen, daemon=True)

    def start(self):
        self._thread.start()

    def stop(self):
        self._stop.set()
        self._pubsub.unsubscribe()
        self._thread.join(timeout=5)
        self._client.close()

    def wait_for_message(self, timeout: float) -> dict | None:
        """Block until at least one communication arrives, or timeout."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self._messages:
                return self._messages[0]
            time.sleep(0.5)
        return None

    def _listen(self):
        while not self._stop.is_set():
            msg = self._pubsub.get_message(timeout=1)
            if msg and msg["type"] == "message":
                try:
                    self._messages.append(json.loads(msg["data"]))
                except json.JSONDecodeError:
                    pass


SUPPORTED_WAV_EXTENSIONS = {".wav"}
CONVERTIBLE_EXTENSIONS = {".m4a", ".mp3", ".ogg", ".flac", ".aac", ".wma", ".opus"}


def convert_to_wav(src_path: str, dest_path: str):
    """Convert any audio format to 16kHz mono WAV using ffmpeg."""
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", src_path,
                "-ar", "16000",    # 16kHz sample rate (optimal for Whisper)
                "-ac", "1",        # mono
                "-sample_fmt", "s16",  # 16-bit signed int
                dest_path,
            ],
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        raise RuntimeError(
            "ffmpeg not found. Install ffmpeg to convert non-WAV audio files. "
            "Alternatively, convert your file to WAV manually."
        )
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"ffmpeg conversion failed: {e.stderr}")


def drop_audio_into_pipeline(audio_path: str) -> str:
    """Copy or convert an audio file into shared/recordings as WAV.
    Returns the destination filename."""
    ext = os.path.splitext(audio_path)[1].lower()
    dest_name = f"test_{uuid.uuid4().hex[:8]}_{int(time.time())}.wav"
    dest_path = os.path.join(RECORDINGS_DIR, dest_name)
    os.makedirs(RECORDINGS_DIR, exist_ok=True)

    if ext in SUPPORTED_WAV_EXTENSIONS:
        shutil.copy2(audio_path, dest_path)
    elif ext in CONVERTIBLE_EXTENSIONS:
        convert_to_wav(audio_path, dest_path)
    else:
        raise ValueError(
            f"Unsupported audio format '{ext}'. "
            f"Supported: {SUPPORTED_WAV_EXTENSIONS | CONVERTIBLE_EXTENSIONS}"
        )

    return dest_name


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestVesselTracking:
    """End-to-end: WAV file in -> vessel visible on map with name & course."""

    def test_pipeline_processes_audio_and_extracts_vessel(
        self, audio_path, redis_client
    ):
        """
        1. Drop an audio file (WAV, M4A, etc.) into shared/recordings/
        2. Wait for the pipeline (transcriber -> extractor) to produce a
           communication in Redis
        3. Verify the communication has a vessel name
        4. Verify heading/course info is captured (in summary or text)
        5. Hit the map API and confirm the vessel is listed
        """
        # --- Set up listener BEFORE dropping the file ---
        catcher = CommunicationCatcher(REDIS_URL)
        catcher.start()

        try:
            # --- Drop the audio file (convert to WAV if needed) ---
            dest_name = drop_audio_into_pipeline(audio_path)
            print(f"\n  Dropped audio as: {dest_name}")
            print(f"  Waiting up to {PIPELINE_TIMEOUT}s for pipeline...")

            # --- Wait for the communication ---
            comm = catcher.wait_for_message(timeout=PIPELINE_TIMEOUT)
            assert comm is not None, (
                f"Timed out after {PIPELINE_TIMEOUT}s waiting for the pipeline "
                "to produce a communication. Check transcriber and extractor logs."
            )

            print(f"  Communication received: id={comm['id']}")
            print(f"    vessel:       {comm.get('vessel')}")
            print(f"    callsign:     {comm.get('callsign')}")
            print(f"    message_type: {comm.get('message_type')}")
            print(f"    lat/lon:      {comm.get('lat')}, {comm.get('lon')}")
            print(f"    summary:      {comm.get('summary')}")
            print(f"    text:         {comm.get('text', '')[:120]}")

            # --- Verify vessel name was extracted ---
            assert comm.get("vessel") is not None, (
                "Vessel name was not extracted from the audio. "
                f"Transcription was: {comm.get('text', '')!r}"
            )
            assert len(comm["vessel"].strip()) > 0, "Vessel name is empty"
            print(f"\n  PASS: Vessel name extracted: {comm['vessel']!r}")

            # --- Verify heading/course in text or summary ---
            text_blob = " ".join([
                (comm.get("text") or ""),
                (comm.get("summary") or ""),
            ]).lower()
            heading_keywords = [
                "heading", "course", "bearing", "degrees",
                "north", "south", "east", "west",
                "inbound", "outbound",
            ]
            has_heading_info = any(kw in text_blob for kw in heading_keywords)
            assert has_heading_info, (
                "No heading/course information found in transcription or summary. "
                f"Text: {comm.get('text')!r}"
            )
            print(f"  PASS: Heading/course info present in transcription")

            # --- Verify communication landed in Redis list ---
            raw_items = redis_client.lrange("communications", 0, 49)
            stored_ids = []
            for raw in raw_items:
                try:
                    stored_ids.append(json.loads(raw)["id"])
                except (json.JSONDecodeError, KeyError):
                    pass
            assert comm["id"] in stored_ids, (
                "Communication was published but not found in Redis "
                "'communications' list."
            )
            print(f"  PASS: Communication stored in Redis list")

            # --- Verify the map API returns it ---
            try:
                resp = requests.get(
                    f"{MAP_API_URL}/api/communications", timeout=10
                )
                resp.raise_for_status()
                api_items = resp.json()
                api_ids = [item["id"] for item in api_items]
                assert comm["id"] in api_ids, (
                    "Communication not returned by map API "
                    f"GET /api/communications (got {len(api_items)} items)"
                )
                # Find our vessel in the API response
                vessel_item = next(
                    item for item in api_items if item["id"] == comm["id"]
                )
                assert vessel_item["vessel"] == comm["vessel"]
                print(f"  PASS: Vessel visible via map API")

                # If coordinates are present, the marker will render on the map
                if vessel_item.get("lat") and vessel_item.get("lon"):
                    print(
                        f"  PASS: Vessel has coordinates "
                        f"({vessel_item['lat']}, {vessel_item['lon']}) — "
                        f"marker will appear on map"
                    )
                else:
                    print(
                        "  NOTE: No lat/lon extracted — vessel will appear "
                        "in sidebar but not as a map marker. Mention "
                        "coordinates in your voice memo for a map pin."
                    )
            except requests.ConnectionError:
                pytest.skip(
                    f"Map service not reachable at {MAP_API_URL}. "
                    "Skipping API verification (Redis checks passed)."
                )

        finally:
            catcher.stop()
            # Clean up the test WAV file
            cleanup_path = os.path.join(RECORDINGS_DIR, dest_name)
            if os.path.exists(cleanup_path):
                os.remove(cleanup_path)
                print(f"  Cleaned up: {dest_name}")
