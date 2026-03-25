#!/usr/bin/env python3
"""
VHF14 Extractor - Subscribes to Redis 'transcriptions' channel, uses LM Studio to
extract structured information, and stores results in Redis 'communications' list.
"""

import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone

import redis
from openai import OpenAI, APIConnectionError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [extractor] %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
LM_STUDIO_URL = os.environ.get("LM_STUDIO_URL", "http://localhost:1234/v1")
LM_STUDIO_MODEL = os.environ.get("LM_STUDIO_MODEL", "mlx-community/gemma-3-1b-it-qat-4bit")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
MAX_COMMUNICATIONS = 100


SYSTEM_PROMPT = "You are a VHF marine radio communications analyst. Extract structured data from radio transcriptions and respond only with valid JSON."

EXTRACTION_PROMPT = """\
Extract structured information from this VHF marine radio transcription.

Transcription: "{text}"

Respond ONLY with a valid JSON object with these exact fields:
- "vessel": string or null — vessel name if mentioned
- "callsign": string or null — radio callsign if mentioned (e.g. "WDG4321")
- "channel": string or null — VHF channel number if mentioned (e.g. "16", "22A")
- "lat": number or null — decimal latitude if a position is mentioned
- "lon": number or null — decimal longitude if a position is mentioned
- "message_type": one of "routine", "safety", "distress", "traffic"
- "summary": string — a concise one-sentence summary of the communication"""


def build_communication(transcription: dict, extracted: dict) -> dict:
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


def _parse_extraction(raw: str) -> dict | None:
    """Parse JSON from an LLM response, stripping markdown fences if present."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    extracted = json.loads(raw)

    valid_types = {"routine", "safety", "distress", "traffic"}
    if extracted.get("message_type") not in valid_types:
        extracted["message_type"] = "routine"

    return extracted


def _default_extraction(text: str) -> dict:
    return {
        "vessel": None,
        "callsign": None,
        "channel": None,
        "lat": None,
        "lon": None,
        "message_type": "routine",
        "summary": text[:200],
    }


def call_lm_studio(text: str, client: OpenAI) -> dict | None:
    """Call LM Studio OpenAI-compatible API to extract structured data.
    Returns None on failure so the caller can try a fallback."""
    prompt = EXTRACTION_PROMPT.format(text=text)

    try:
        response = client.chat.completions.create(
            model=LM_STUDIO_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            max_tokens=256,
        )
        raw = response.choices[0].message.content.strip()
        log.debug(f"LM Studio response: {raw[:200]}")
        return _parse_extraction(raw)

    except APIConnectionError as e:
        log.error(f"Cannot reach LM Studio at {LM_STUDIO_URL}: {e}")
    except json.JSONDecodeError as e:
        log.warning(f"LM Studio returned non-JSON: {e}")
    except Exception as e:
        log.error(f"Unexpected error calling LM Studio: {e}")

    return None


def call_gemini(text: str) -> dict | None:
    """Fallback: call Google Gemini API for entity extraction."""
    if not GEMINI_API_KEY:
        log.debug("No GEMINI_API_KEY configured, skipping Gemini fallback")
        return None

    try:
        import google.generativeai as genai

        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel(GEMINI_MODEL)

        prompt = (
            SYSTEM_PROMPT + "\n\n" + EXTRACTION_PROMPT.format(text=text)
        )
        response = model.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                temperature=0.1,
                max_output_tokens=256,
            ),
        )
        raw = response.text.strip()
        log.debug(f"Gemini response: {raw[:200]}")
        return _parse_extraction(raw)

    except json.JSONDecodeError as e:
        log.warning(f"Gemini returned non-JSON: {e}")
    except Exception as e:
        log.error(f"Gemini fallback failed: {e}")

    return None


def extract(text: str, lm_client: OpenAI) -> dict:
    """Try LM Studio first, fall back to Gemini, then return defaults."""
    result = call_lm_studio(text, lm_client)
    if result is not None:
        return result

    log.info("LM Studio extraction failed, trying Gemini fallback...")
    result = call_gemini(text)
    if result is not None:
        log.info("Gemini fallback succeeded")
        return result

    log.warning("All extraction backends failed, using defaults")
    return _default_extraction(text)


def store_communication(redis_client: redis.Redis, communication: dict):
    comm_json = json.dumps(communication)
    pipe = redis_client.pipeline()
    pipe.lpush("communications", comm_json)
    pipe.ltrim("communications", 0, MAX_COMMUNICATIONS - 1)
    pipe.publish("communications_updates", comm_json)
    pipe.execute()
    log.info(
        f"Stored id={communication['id']} vessel={communication['vessel']!r} "
        f"type={communication['message_type']} summary={communication['summary'][:60]!r}"
    )


def wait_for_redis(redis_url: str, retries: int = 30, delay: float = 2.0) -> redis.Redis:
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
    raise SystemExit(1)


def wait_for_lm_studio(client: OpenAI, retries: int = 20, delay: float = 3.0) -> bool:
    """Returns True if LM Studio came online, False otherwise."""
    log.info(f"Waiting for LM Studio at {LM_STUDIO_URL}...")
    for attempt in range(1, retries + 1):
        try:
            client.models.list()
            log.info("LM Studio is ready.")
            return True
        except Exception as e:
            log.warning(f"LM Studio not ready (attempt {attempt}/{retries}): {e}")
            if attempt < retries:
                time.sleep(delay)
    return False


def main():
    log.info(f"VHF14 Extractor starting — LM Studio: {LM_STUDIO_URL}, model: {LM_STUDIO_MODEL}")
    if GEMINI_API_KEY:
        log.info(f"Gemini fallback enabled (model: {GEMINI_MODEL})")
    else:
        log.info("Gemini fallback not configured (no GEMINI_API_KEY)")

    redis_client = wait_for_redis(REDIS_URL)

    lm_client = OpenAI(base_url=LM_STUDIO_URL, api_key="lm-studio")
    lm_ready = wait_for_lm_studio(lm_client)

    if not lm_ready and not GEMINI_API_KEY:
        log.error("LM Studio unavailable and no Gemini fallback configured — exiting")
        raise SystemExit(1)
    if not lm_ready:
        log.warning("LM Studio unavailable — will rely on Gemini fallback")

    pubsub = redis_client.pubsub(ignore_subscribe_messages=True)
    pubsub.subscribe("transcriptions")
    log.info("Subscribed to 'transcriptions'. Waiting for messages...")

    for message in pubsub.listen():
        if message["type"] != "message":
            continue

        try:
            transcription = json.loads(message["data"])
        except json.JSONDecodeError as e:
            log.error(f"Failed to parse message: {e}")
            continue

        text = transcription.get("text", "").strip()
        if not text:
            continue

        log.info(f"Processing id={transcription.get('id')} text={text[:80]!r}")
        extracted = extract(text, lm_client)
        communication = build_communication(transcription, extracted)
        store_communication(redis_client, communication)


if __name__ == "__main__":
    main()
