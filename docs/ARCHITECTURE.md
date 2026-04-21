# VHF14 Architecture

Audio is captured in a browser tab, processed on an Intel Mac, and served from Vercel. The Mac must be online for data to flow; the Vercel frontend remains accessible regardless.

---

## Nodes

### Capture browser
- **Role**: Audio capture and voice-activity detection
- **Location**: A Chrome or Safari tab running on the machine connected to the VHF radio's audio output (typically the Mac itself)
- **Implementation**: `services/map/src/hooks/useAudioCapture.js` — `getUserMedia` + silero-vad (`@ricky0123/vad-web`). On `onSpeechEnd`, encodes 16kHz mono Float32 PCM into a WAV Blob and POSTs it to `/api/audio`.
- **UI**: Floating pill modal (`SpeechModal.jsx`) appears while speech is active.

### Intel Mac — `ez@ethans-sidequest`
- **Role**: Audio ingest, ML processing, data store, API
- **Services**: `transcriber`, `extractor`, `redis`, `api` (all via Docker Compose)
- **SSH access**: `ssh ez@ethans-sidequest`
- **Public API**: Exposed on port 3000 via Tailscale Funnel

### Vercel — `vhf14` project
- **Role**: Static frontend hosting
- **URL**: Set after first deploy (e.g. `https://vhf14.vercel.app`)
- **What's deployed**: Built React SPA (`services/map/dist/`)
- **API calls**: All requests go to the Tailscale Funnel URL via `VITE_API_URL`

---

## Network Topology

```
[Capture browser]
  silero-vad
  WAV encoder
    │  HTTPS POST /api/audio (via Tailscale Funnel)
    ▼
[Intel Mac — ethans-sidequest]
  api                   ← Express + SSE, port 3000; also writes shared/recordings/
  shared/recordings/    ← WAV files land here
  transcriber           ← Whisper, reads from shared/recordings/
  extractor             ← Gemini API, reads Redis pub/sub
  redis                 ← data store + message bus (Docker internal)
    │  Tailscale Funnel (HTTPS)
    ▼
[Internet]
    │
    ▼
[Vercel]
  React SPA             ← static, CDN-served
    │  fetch + EventSource to Funnel URL
    ▼
[Browser]
```

---

## Services Per Node

| Service | Node | Managed by | Port |
|---|---|---|---|
| capture | Browser | User-activated in the frontend UI | — |
| transcriber | Intel Mac | Docker Compose | — (internal) |
| extractor | Intel Mac | Docker Compose | — (internal) |
| redis | Intel Mac | Docker Compose | 6379 (internal) |
| api | Intel Mac | Docker Compose | 3000 (Funnel) |
| map frontend | Vercel | Vercel | 443 |

---

## Redis Data Model

### List: `communications`
Capped at 100 entries. Newest at index 0.

```json
{
  "id": "uuid4",
  "timestamp": "2026-03-25T14:15:00Z",
  "text": "raw transcription text",
  "vessel": "string or null",
  "callsign": "string or null",
  "channel": "string or null",
  "lat": "number or null",
  "lon": "number or null",
  "message_type": "routine | safety | distress | traffic",
  "summary": "one-sentence plain-English summary"
}
```

### Pub/Sub Channel: `transcriptions`
Published by `transcriber`. Consumed by `extractor`.

```json
{
  "id": "uuid4",
  "timestamp": "2026-03-25T14:15:00Z",
  "file": "recording_20260325_141500.wav",
  "text": "raw transcription text"
}
```

### Pub/Sub Channel: `communications_updates`
Published by `extractor` (same payload as the `communications` list entry). Consumed by `api` for SSE fan-out to browsers.

---

## Environment Variables

### Intel Mac (`.env` in project root)
| Variable | Default | Description |
|---|---|---|
| `WHISPER_MODEL` | `base.en` | Whisper model size (tiny/base/small/medium/large) |
| `GEMINI_API_KEY` | — | Google Gemini API key for extractor |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Gemini model name |
| `LM_STUDIO_URL` | `http://host.docker.internal:1234/v1` | LM Studio endpoint (fallback if no Gemini key) |
| `LM_STUDIO_MODEL` | `mlx-community/gemma-3-1b-it-qat-4bit` | LM Studio model name |
| `RECORDINGS_DIR` | `/app/recordings` | Where the API writes uploaded WAVs (inside the api container; backed by the `./shared/recordings` host bind mount) |

### Vercel (set in Vercel project dashboard)
| Variable | Description |
|---|---|
| `VITE_MAPBOX_TOKEN` | Mapbox GL public token (build-time) |
| `VITE_API_URL` | Full Tailscale Funnel URL, e.g. `https://ethans-sidequest.tail-xxxxx.ts.net` |

---

## Ports and Protocols

| Port | Protocol | Where | Purpose |
|---|---|---|---|
| 6379 | TCP | Docker internal | Redis (not exposed to host) |
| 3000 | HTTP | Mac localhost | API server |
| 3000 | HTTPS | Tailscale Funnel | API server (public) |
| 443 | HTTPS | Vercel CDN | React frontend |

---

## Tailscale Funnel Setup (Mac)

```bash
# Install
brew install tailscale

# Authenticate
tailscale up

# Expose port 3000
tailscale funnel 3000

# Run in background persistently
tailscale funnel --bg 3000

# Check Funnel URL
tailscale funnel status
```

The Funnel URL (`https://<hostname>.tail-xxxxx.ts.net`) is stable across restarts. Set it as `VITE_API_URL` in Vercel.

---

## Audio Ingest (`POST /api/audio`)

The capture browser encodes each detected speech segment as a 16-bit PCM mono WAV (16 kHz) and uploads it:

```
POST /api/audio HTTP/1.1
Content-Type: audio/wav
Content-Length: <bytes>

<RIFF...WAVE payload>
```

Server behavior (`services/map/api/server.js`):
- Validates RIFF + WAVE magic bytes.
- Writes to `${RECORDINGS_DIR}/recording_YYYYMMDD_HHMMSS.wav.tmp`, then `fs.rename` to the final `.wav`. The atomic rename prevents the transcriber's watchdog from picking up a partial write before it fully lands.
- Max body size: 20 MiB.
- Returns `{ "file": "...", "bytes": N }` on success.

The transcriber's 2-second settle delay (`services/transcriber/transcriber.py:32`) is kept as belt-and-suspenders.
