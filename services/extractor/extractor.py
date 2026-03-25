#!/usr/bin/env python3
"""
VHF14 Extractor - Subscribes to Redis 'transcriptions' channel, uses Ollama to
extract structured information, and stores results in Redis 'communications' list.
"""

import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone

import httpx
import redis

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [extractor] %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://ollama:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "phi3")
MAX_COMMUNICATIONS = 100
OLLAMA_TIMEOUT = 120.0  # seconds


EXTRACTION_PROMPT = """\
You are a VHF marine radio communications analyst. Extract structured information from the following radio transcription.

Transcription: "{text}"

Respond ONLY with a valid JSON object (no markdown, no explanation) with these exact fields:
- "vessel": string or null - vessel name if mentioned
- "callsign": string or null - radio callsign if mentioned (e.g. "WDG4321")
- "channel": string or null - VHF channel number if mentioned (e.g. "16", "22A")
- "lat": number or null - decimal latitude if a position is mentioned
- "lon": number or null - decimal longitude if a position is mentioned
- "message_type": one of "routine", "safety", "distress", "traffic"
- "summary": string - a concise one-sentence summary of the communication

JSON response:"""


def build_communication(transcription: dict, extracted: dict) -> dict:
    """Merge transcription data with extracted fields into a communication record."""
    return {
        "id": transcription.get("id", str(uuid.uuid4())),
        "timestamp": transcription.get("timestamp", datetime.now(timezone.utc).isoformat()),
        "text": transcription.get("text", ""),
        "vessel": extracted.get("vessel"),
        "callsign": extracted.get("callsign"),
        "channel": extracted.get("channel"),
        "lat": extracted.get("lat"),
        "lon": extracted.get("lon"),
        "message_type": extracted.get("message_type", "routine"),
        "summary": extracted.get("summary", transcription.get("text", "")[:200]),
    }


def call_ollama(text: str, client: httpx.Client) -> dict:
    """
    Call Ollama API to extract structured data from transcription text.
    Returns extracted dict, or a fallback dict on failure.
    """
    prompt = EXTRACTION_PROMPT.format(text=text)
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "format": "json",
    }

    try:
        response = client.post(
            f"{OLLAMA_URL}/api/generate",
            json=payload,
            timeout=OLLAMA_TIMEOUT,
        )
        response.raise_for_status()
        result = response.json()
        raw_response = result.get("response", "")
        log.debug(f"Ollama raw response: {raw_response[:200]}")

        # Attempt to parse JSON from the response
        extracted = json.loads(raw_response)

        # Validate message_type is one of the expected values
        valid_types = {"routine", "safety", "distress", "traffic"}
        if extracted.get("message_type") not in valid_types:
            extracted["message_type"] = "routine"

        return extracted

    except httpx.HTTPStatusError as e:
        log.error(f"Ollama HTTP error {e.response.status_code}: {e.response.text[:200]}")
    except httpx.RequestError as e:
        log.error(f"Ollama request failed: {e}")
    except json.JSONDecodeError as e:
        log.warning(f"Ollama returned non-JSON response: {e}")
    except Exception as e:
        log.error(f"Unexpected error calling Ollama: {e}")

    # Fallback: return minimal structure
    return {
        "vessel": None,
        "callsign": None,
        "channel": None,
        "lat": None,
        "lon": None,
        "message_type": "routine",
        "summary": text[:200],
    }


def store_communication(redis_client: redis.Redis, communication: dict):
    """Store communication in Redis list and publish update notification."""
    comm_json = json.dumps(communication)

    pipe = redis_client.pipeline()
    pipe.lpush("communications", comm_json)
    pipe.ltrim("communications", 0, MAX_COMMUNICATIONS - 1)
    pipe.publish("communications_updates", comm_json)
    pipe.execute()

    log.info(
        f"Stored communication id={communication['id']} "
        f"vessel={communication['vessel']!r} "
        f"type={communication['message_type']} "
        f"summary={communication['summary'][:60]!r}"
    )


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
    log.error("Could not connect to Redis. Exiting.")
    raise SystemExit(1)


def wait_for_ollama(ollama_url: str, retries: int = 30, delay: float = 5.0):
    """Block until Ollama is reachable."""
    log.info(f"Waiting for Ollama at {ollama_url}...")
    for attempt in range(1, retries + 1):
        try:
            with httpx.Client() as client:
                resp = client.get(f"{ollama_url}/api/tags", timeout=5.0)
                resp.raise_for_status()
            log.info("Ollama is ready.")
            return
        except Exception as e:
            log.warning(f"Ollama not ready (attempt {attempt}/{retries}): {e}")
            if attempt < retries:
                time.sleep(delay)
    log.error("Could not reach Ollama. Exiting.")
    raise SystemExit(1)


def main():
    log.info("VHF14 Extractor starting")
    log.info(f"Redis URL: {REDIS_URL}")
    log.info(f"Ollama URL: {OLLAMA_URL}, model: {OLLAMA_MODEL}")

    redis_client = wait_for_redis(REDIS_URL)
    wait_for_ollama(OLLAMA_URL)

    pubsub = redis_client.pubsub(ignore_subscribe_messages=True)
    pubsub.subscribe("transcriptions")
    log.info("Subscribed to Redis channel 'transcriptions'. Waiting for messages...")

    with httpx.Client() as http_client:
        for message in pubsub.listen():
            if message["type"] != "message":
                continue

            raw_data = message["data"]
            try:
                transcription = json.loads(raw_data)
            except json.JSONDecodeError as e:
                log.error(f"Failed to parse transcription message: {e} — data: {raw_data[:200]}")
                continue

            text = transcription.get("text", "").strip()
            if not text:
                log.warning("Received transcription with empty text, skipping.")
                continue

            log.info(f"Processing transcription id={transcription.get('id')} text={text[:80]!r}")

            extracted = call_ollama(text, http_client)
            communication = build_communication(transcription, extracted)
            store_communication(redis_client, communication)


if __name__ == "__main__":
    main()
