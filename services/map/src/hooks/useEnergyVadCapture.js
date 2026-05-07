import { useCallback, useEffect, useRef, useState } from "react";
import { encodeWav, resampleLinear, rmsMono } from "../lib/wav.js";

function mixToMono(inputBuffer) {
  const ch = inputBuffer.numberOfChannels;
  const frames = inputBuffer.length;
  if (ch === 1) {
    return Float32Array.from(inputBuffer.getChannelData(0));
  }
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) s += inputBuffer.getChannelData(c)[i];
    out[i] = s / ch;
  }
  return out;
}

const EXPORT_SAMPLE_RATE = 16000;
const DEVICE_KEY = "vhf14.captureDeviceId";

/** @typedef {{ startRms: number, endRms: number, silenceMs: number, minSpeechMs: number, maxSegmentMs: number, preRollMs: number }} VadOptions */

const defaultOptions = {
  startRms: 0.025,
  endRms: 0.012,
  silenceMs: 550,
  minSpeechMs: 250,
  maxSegmentMs: 120_000,
  preRollMs: 240,
};

/**
 * Naive energy-threshold VAD: record while level is high, end after sustained silence.
 * Uploads completed segments as WAV to POST /api/audio-recordings.
 */
export function useEnergyVadCapture({ apiBase = "", enabled, options = {} } = {}) {
  const opts = { ...defaultOptions, ...options };
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceIdState] = useState(() => localStorage.getItem(DEVICE_KEY) || "");
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [segmentsSaved, setSegmentsSaved] = useState(0);
  const [lastError, setLastError] = useState(null);

  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);

  const setDeviceId = useCallback((id) => {
    setDeviceIdState(id);
    if (id) localStorage.setItem(DEVICE_KEY, id);
    else localStorage.removeItem(DEVICE_KEY);
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === "audioinput"));
    } catch (e) {
      console.error("[vad] enumerateDevices:", e);
    }
  }, []);

  useEffect(() => {
    refreshDevices();
    const onChange = () => refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
  }, [refreshDevices]);

  const uploadWav = useCallback(
    async (blob) => {
      try {
        const res = await fetch(`${apiBase}/api/audio-recordings`, {
          method: "POST",
          headers: { "Content-Type": "audio/wav" },
          body: blob,
        });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(t || `HTTP ${res.status}`);
        }
        setSegmentsSaved((n) => n + 1);
      } catch (e) {
        console.error("[vad] upload failed:", e);
        setLastError(e.message || String(e));
      }
    },
    [apiBase]
  );

  useEffect(() => {
    if (!enabled) {
      setListening(false);
      setSpeaking(false);
      setLevel(0);
      return;
    }

    let cancelled = false;
    const BUFFER_SIZE = 4096;

    async function start() {
      setLastError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        refreshDevices();

        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        audioCtxRef.current = ctx;
        await ctx.resume();

        const source = ctx.createMediaStreamSource(stream);
        sourceRef.current = source;
        const inputCh = Math.min(6, source.channelCount || 1);

        const inputRate = ctx.sampleRate;
        const bufferDurationMs = (BUFFER_SIZE / inputRate) * 1000;
        const silenceBuffers = Math.max(2, Math.ceil(opts.silenceMs / bufferDurationMs));
        const startBuffers = Math.max(2, Math.ceil(120 / bufferDurationMs));
        const maxPreRollSamples = Math.floor((opts.preRollMs / 1000) * inputRate);
        const minSpeechSamples = Math.floor((opts.minSpeechMs / 1000) * inputRate);
        const maxSegmentSamples = Math.floor((opts.maxSegmentMs / 1000) * inputRate);

        /** @type {Float32Array[]} */
        const preChunks = [];

        function pushPreRoll(mono) {
          preChunks.push(mono);
          let total = 0;
          for (const c of preChunks) total += c.length;
          while (total > maxPreRollSamples && preChunks.length > 0) {
            const removed = preChunks.shift();
            total -= removed.length;
          }
        }

        function flattenPreRoll() {
          if (preChunks.length === 0) return new Float32Array(0);
          const total = preChunks.reduce((a, c) => a + c.length, 0);
          const out = new Float32Array(total);
          let o = 0;
          for (const c of preChunks) {
            out.set(c, o);
            o += c.length;
          }
          return out;
        }

        let active = false;
        let loudStreak = 0;
        let quietStreak = 0;
        /** @type {Float32Array[]} */
        const segmentChunks = [];
        let segmentSamples = 0;

        function appendSegment(mono) {
          segmentChunks.push(Float32Array.from(mono));
          segmentSamples += mono.length;
        }

        function flushSegment() {
          if (segmentSamples < minSpeechSamples) {
            segmentChunks.length = 0;
            segmentSamples = 0;
            return;
          }
          const merged = new Float32Array(segmentSamples);
          let o = 0;
          for (const ch of segmentChunks) {
            merged.set(ch, o);
            o += ch.length;
          }
          segmentChunks.length = 0;
          segmentSamples = 0;

          const at16k = resampleLinear(merged, inputRate, EXPORT_SAMPLE_RATE);
          const blob = encodeWav(at16k, EXPORT_SAMPLE_RATE);
          uploadWav(blob);
        }

        const processor = ctx.createScriptProcessor(BUFFER_SIZE, inputCh, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          const mono = mixToMono(e.inputBuffer);
          const rms = rmsMono(mono, 1);
          setLevel(Math.min(1, rms * 8));

          if (!active) {
            pushPreRoll(mono);
            if (rms >= opts.startRms) {
              loudStreak += 1;
              quietStreak = 0;
              if (loudStreak >= startBuffers) {
                active = true;
                loudStreak = 0;
                quietStreak = 0;
                setSpeaking(true);
                const head = flattenPreRoll();
                if (head.length) appendSegment(head);
                appendSegment(mono);
              }
            } else {
              loudStreak = 0;
            }
          } else {
            appendSegment(mono);
            if (rms <= opts.endRms) {
              quietStreak += 1;
              loudStreak = 0;
              if (quietStreak >= silenceBuffers) {
                active = false;
                quietStreak = 0;
                setSpeaking(false);
                flushSegment();
              }
            } else {
              quietStreak = 0;
            }

            if (segmentSamples >= maxSegmentSamples) {
              flushSegment();
              quietStreak = 0;
              loudStreak = 0;
              if (rms >= opts.startRms) {
                appendSegment(mono);
                active = true;
                setSpeaking(true);
              } else {
                active = false;
                setSpeaking(false);
              }
            }
          }
        };

        source.connect(processor);
        processor.connect(ctx.destination);
        setListening(true);
      } catch (e) {
        console.error("[vad] start error:", e);
        setLastError(e.message || String(e));
        setListening(false);
      }
    }

    start();

    return () => {
      cancelled = true;
      try {
        processorRef.current?.disconnect();
        sourceRef.current?.disconnect();
      } catch (_) {}
      processorRef.current = null;
      sourceRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      setListening(false);
      setSpeaking(false);
      setLevel(0);
    };
  }, [enabled, deviceId, opts.startRms, opts.endRms, opts.silenceMs, opts.minSpeechMs, opts.maxSegmentMs, opts.preRollMs, refreshDevices, uploadWav]);

  return {
    devices,
    deviceId,
    setDeviceId,
    speaking,
    listening,
    level,
    segmentsSaved,
    lastError,
    clearError: () => setLastError(null),
  };
}
