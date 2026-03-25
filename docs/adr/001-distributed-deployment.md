# ADR 001: Distribute VHF14 Across Pi, Mac, and Vercel

**Status**: Accepted
**Date**: 2026-03-25

---

## Context

VHF14 was originally built as a monolithic Docker Compose stack running on a single machine. Three requirements forced a distribution:

1. The **recorder** must be physically co-located with the VHF radio on the boat. A Raspberry Pi is the natural fit — small, low-power, always-on.
2. The **transcriber** (Whisper) and **extractor** (LLM inference) require meaningful CPU/memory. The Pi can't handle this; an always-on Intel Mac is available.
3. The **map frontend** should be publicly accessible from any browser without requiring the Mac to serve HTTP traffic directly on a known address.

---

## Decision

Split the system across three nodes:

| Node | Runs |
|---|---|
| Raspberry Pi (boat) | recorder |
| Intel Mac (`ethans-sidequest`) | transcriber, extractor, Redis, API |
| Vercel | map frontend (static SPA) |

**Key choices within this decision:**

- **Keep the Express API on the Mac alongside Redis.** The alternative was to deploy the API to Vercel serverless functions with Upstash Redis. This was rejected (see Alternatives below).
- **Tailscale Funnel to expose the API.** The Mac's port 3000 is published to the internet via Tailscale Funnel. The Vercel frontend calls this URL for both the REST endpoint and the SSE stream.
- **rsync-over-SSH for Pi → Mac file transfer.** The recorder writes 30-second WAV chunks. After each save, `rsync -az` uploads to the Mac and optionally deletes the local copy.

---

## Alternatives Considered

### Upstash Redis + Vercel Serverless API
Restructure the Express server into Vercel serverless functions; use Upstash Redis as a cloud-hosted message broker accessible to both local services and Vercel.

**Rejected because:**
- Vercel serverless functions have a 10-second timeout on the Hobby plan. The SSE `/api/stream` endpoint requires a long-lived connection — this would break real-time updates.
- Upstash does not support traditional Redis pub/sub over its REST API. The transcriber → extractor pub/sub pattern would require a workaround (polling, Upstash Kafka, or QStash), adding significant complexity.
- Upstash adds a cost dependency. The Mac is already required to be online for transcription, so co-locating Redis there is free.

### Cloudflare Tunnel
Similar to Tailscale Funnel but requires a Cloudflare account and optionally a custom domain.

**Not chosen:** User already has Tailscale. Tailscale Funnel achieves the same result with zero additional accounts.

### ngrok
Quick to set up, widely familiar.

**Rejected:** The free tier assigns a random URL on each restart, which would require updating the Vercel `VITE_API_URL` environment variable every time the Mac reboots. Paid ngrok gets stable URLs but adds cost.

### NFS / SMB shared mount (Pi → Mac)
Mount the Mac's `shared/recordings/` directory over the local network and have the recorder write directly to it.

**Not chosen:** Brittle when the boat leaves the dock (network mount drops). rsync-over-SSH is resilient — it simply fails the upload for that chunk and logs a warning, while recording continues uninterrupted.

---

## Consequences

- The Mac must be online for transcription, extraction, and API access. If the Mac is off, the Vercel frontend loads but shows no data and the SSE indicator shows "Reconnecting".
- Tailscale must be running on the Mac for the API to be publicly accessible. `tailscale funnel --bg 3000` should be set up as a persistent background service.
- The Pi needs network access to the Mac for rsync. On the open ocean, this requires the Pi and Mac to be on the same Tailscale network (both enrolled as Tailscale nodes).
- WAV files accumulate on the Mac in `shared/recordings/`. A cleanup policy (e.g. delete after successful transcription) should be added to the transcriber in the future.
