"use strict";

const express = require("express");
const cors = require("cors");
const Redis = require("ioredis");

const PORT = 3000;
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const COMMUNICATIONS_KEY = "communications";
const UPDATES_CHANNEL = "communications_updates";
const MAX_FETCH = 50;

const app = express();
app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// Redis clients
// ---------------------------------------------------------------------------

function createRedisClient(label) {
  const client = new Redis(REDIS_URL, {
    lazyConnect: false,
    retryStrategy(times) {
      const delay = Math.min(times * 500, 5000);
      console.log(`[${label}] Redis reconnect attempt ${times}, waiting ${delay}ms`);
      return delay;
    },
  });

  client.on("connect", () => console.log(`[${label}] Connected to Redis`));
  client.on("error", (err) => console.error(`[${label}] Redis error:`, err.message));

  return client;
}

// One client for commands, one dedicated subscriber for pub/sub
const redisCmd = createRedisClient("cmd");
const redisSub = createRedisClient("sub");

// ---------------------------------------------------------------------------
// GET /api/communications
// Returns the last MAX_FETCH communications from the Redis list.
// ---------------------------------------------------------------------------

app.get("/api/communications", async (req, res) => {
  try {
    const rawItems = await redisCmd.lrange(COMMUNICATIONS_KEY, 0, MAX_FETCH - 1);
    const items = rawItems
      .map((raw) => {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    res.json(items);
  } catch (err) {
    console.error("[api] /api/communications error:", err.message);
    res.status(500).json({ error: "Failed to fetch communications" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/stream
// Server-Sent Events endpoint. Subscribes to Redis pub/sub and streams
// new communications to connected clients.
// ---------------------------------------------------------------------------

// Track active SSE clients so we can broadcast to them all from a single
// Redis subscriber (more efficient than one subscriber per HTTP client).
const sseClients = new Set();

app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering if behind proxy
  res.flushHeaders();

  // Send a comment to establish the connection immediately
  res.write(": connected\n\n");

  sseClients.add(res);
  console.log(`[sse] Client connected. Total: ${sseClients.size}`);

  // Keep-alive ping every 20s to prevent proxy timeouts
  const keepAlive = setInterval(() => {
    res.write(": ping\n\n");
  }, 20_000);

  req.on("close", () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
    console.log(`[sse] Client disconnected. Total: ${sseClients.size}`);
  });
});

// Single Redis subscriber that broadcasts to all SSE clients
redisSub.subscribe(UPDATES_CHANNEL, (err) => {
  if (err) {
    console.error(`[sub] Failed to subscribe to ${UPDATES_CHANNEL}:`, err.message);
  } else {
    console.log(`[sub] Subscribed to Redis channel '${UPDATES_CHANNEL}'`);
  }
});

redisSub.on("message", (channel, message) => {
  if (channel !== UPDATES_CHANNEL) return;

  let payload;
  try {
    payload = JSON.parse(message);
  } catch {
    console.warn("[sub] Received non-JSON message, skipping");
    return;
  }

  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(data);
    } catch (err) {
      console.error("[sse] Failed to write to client:", err.message);
      sseClients.delete(client);
    }
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`[server] VHF14 Map API listening on port ${PORT}`);
  console.log(`[server] Redis URL: ${REDIS_URL}`);
});
