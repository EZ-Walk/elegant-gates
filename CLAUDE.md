# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VHF14 is a marine radio monitor system designed to capture, transcribe, and analyze VHF marine radio communications. Audio is captured in the browser via a voice-activity-triggered flow, processed on an Intel Mac, and served to a Vercel-hosted frontend.

## Architecture

### Intel Mac (`ez@ethans-sidequest`)
- **transcriber** — Whisper AI, watches `shared/recordings/` for new WAVs
- **extractor** — Gemini API, subscribes to Redis `transcriptions` channel
- **redis** — message bus + data store (Docker internal, port 6379)
- **api** — Express + SSE server (port 3000), also accepts WAV uploads at `POST /api/audio`; exposed via Tailscale Funnel

### Browser (any authorized device; primary is the Mac's own browser)
- **capture** — silero-vad in-browser (`@ricky0123/vad-web`) detects speech, uploads 16kHz mono WAV segments to the API; shows a floating waveform modal while actively capturing

### Vercel
- **map frontend** — React + Mapbox GL static SPA, calls the Mac's API via `VITE_API_URL`

For full topology, env vars, and Redis schema details see `docs/ARCHITECTURE.md`.

## Development Commands

### Mac — start backend services
```bash
make up              # start redis, transcriber, extractor, api
make down            # stop all
make logs            # tail all service logs
docker compose logs -f api   # tail a specific service
docker compose up --build api  # rebuild and restart api
```

### Mac — local frontend dev
```bash
cd services/map
npm install
npm run dev          # Vite dev server on :5173, proxies /api to localhost:3000
npm run build        # build to services/map/dist/
```

### Start capture
Open the frontend URL in a browser on the machine with the VHF audio feed. Click **Capture**, grant mic permission, and pick the VHF input device from the dropdown. The selected device persists in `localStorage`. Keep the tab foregrounded — Web Audio is throttled in backgrounded tabs.

### Vercel — deploy frontend
```bash
vercel deploy        # from repo root; vercel.json points to services/map
```

### Tests
```bash
make test AUDIO=tests/test_001.m4a
# or
python -m pytest tests/ -v --audio tests/test_001.m4a
```

### Clean recordings
```bash
make clean           # rm -f shared/recordings/*.wav
```

## Configuration

### Mac `.env` file
- `WHISPER_MODEL` — Whisper model size (default: `base.en`)
- `GEMINI_API_KEY` — Google Gemini API key (required for extractor)
- `GEMINI_MODEL` — Gemini model (default: `gemini-2.0-flash`)
- `LM_STUDIO_URL` — fallback LLM endpoint if no Gemini key
- `LM_STUDIO_MODEL` — LM Studio model name

### Vercel environment variables (set in dashboard)
- `VITE_MAPBOX_TOKEN` — Mapbox public token (build-time)
- `VITE_API_URL` — Tailscale Funnel URL (e.g. `https://ethans-sidequest.tail-xxxxx.ts.net`)

## Data Flow
1. **browser capture** runs silero-vad locally; on speech end it encodes a 16kHz mono WAV and `POST`s it to `/api/audio`
2. **api** writes the upload into `shared/recordings/recording_YYYYMMDD_HHMMSS.wav` (atomic `.tmp` → rename)
3. **transcriber** (Mac) detects new WAV, Whisper transcribes → publishes to Redis `transcriptions` channel
4. **extractor** (Mac) subscribes to `transcriptions`, calls Gemini → writes to Redis `communications` list + publishes to `communications_updates` channel
5. **api** (Mac) serves `GET /api/communications` (LRANGE) and `GET /api/stream` (SSE, subscribes to `communications_updates`)
6. **frontend** (Vercel) fetches initial data + maintains SSE connection via the Tailscale Funnel URL

## Service Communication
- Browser → API: HTTPS `POST /api/audio` with `Content-Type: audio/wav` (via Tailscale Funnel)
- API → filesystem: writes to `shared/recordings/` (Docker volume)
- Transcriber → Extractor: Redis pub/sub (`transcriptions` channel)
- Extractor → API: Redis list (`communications`) + pub/sub (`communications_updates`)
- API → Frontend: REST (JSON) + SSE (Server-Sent Events) via Tailscale Funnel HTTPS

## File Structure
- `shared/recordings/` — WAV files written by the API, consumed by the transcriber (Docker volume)
- `services/transcriber/` — Whisper transcription service
- `services/extractor/` — LLM extraction service
- `services/map/api/` — Express API server
- `services/map/src/` — React frontend source
- `docker-compose.yml` — Mac services (redis, transcriber, extractor, api)
- `vercel.json` — Vercel build config for the frontend
- `docs/ARCHITECTURE.md` — detailed environment reference
- `docs/adr/` — architecture decision records
