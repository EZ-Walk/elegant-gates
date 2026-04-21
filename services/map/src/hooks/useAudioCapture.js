import { useCallback, useEffect, useRef, useState } from "react";
import { MicVAD } from "@ricky0123/vad-web";
import { encodeWav } from "../lib/wav.js";

// Silero VAD emits 16kHz mono Float32 audio on speech end — exactly what
// Whisper wants, so we forward it as-is.
const VAD_SAMPLE_RATE = 16000;

const DEVICE_KEY = "vhf14.captureDeviceId";

export function useAudioCapture({ apiBase = "" } = {}) {
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceIdState] = useState(
    () => localStorage.getItem(DEVICE_KEY) || ""
  );
  const [enabled, setEnabled] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | starting | listening | error
  const [error, setError] = useState(null);
  const [analyser, setAnalyser] = useState(null);

  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const vadRef = useRef(null);

  const setDeviceId = useCallback((id) => {
    setDeviceIdState(id);
    if (id) localStorage.setItem(DEVICE_KEY, id);
    else localStorage.removeItem(DEVICE_KEY);
  }, []);

  // Enumerate input devices once we have permission
  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === "audioinput"));
    } catch (err) {
      console.error("[capture] enumerateDevices failed:", err);
    }
  }, []);

  useEffect(() => {
    refreshDevices();
    const onChange = () => refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
    };
  }, [refreshDevices]);

  // Upload a completed speech segment
  const uploadSegment = useCallback(
    async (float32) => {
      const blob = encodeWav(float32, VAD_SAMPLE_RATE);
      try {
        const res = await fetch(`${apiBase}/api/audio`, {
          method: "POST",
          headers: { "Content-Type": "audio/wav" },
          body: blob,
        });
        if (!res.ok) {
          console.error("[capture] upload failed:", res.status, await res.text());
        }
      } catch (err) {
        console.error("[capture] upload error:", err);
      }
    },
    [apiBase]
  );

  // Start / stop capture based on `enabled`
  useEffect(() => {
    let cancelled = false;

    async function start() {
      setStatus("starting");
      setError(null);
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

        // Populate device labels now that we have permission
        refreshDevices();

        // Live analyser for the modal waveform
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const node = ctx.createAnalyser();
        node.fftSize = 256;
        node.smoothingTimeConstant = 0.7;
        source.connect(node);
        setAnalyser(node);

        // Silero VAD on its own tap of the same stream
        const vad = await MicVAD.new({
          stream,
          onSpeechStart: () => setIsSpeaking(true),
          onSpeechEnd: (audio) => {
            setIsSpeaking(false);
            uploadSegment(audio);
          },
          onVADMisfire: () => setIsSpeaking(false),
        });
        if (cancelled) {
          vad.destroy();
          ctx.close();
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        vad.start();
        vadRef.current = vad;
        setStatus("listening");
      } catch (err) {
        console.error("[capture] start failed:", err);
        setError(err.message || String(err));
        setStatus("error");
        setEnabled(false);
      }
    }

    function stop() {
      if (vadRef.current) {
        try { vadRef.current.destroy(); } catch {}
        vadRef.current = null;
      }
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch {}
        audioCtxRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setAnalyser(null);
      setIsSpeaking(false);
      setStatus("idle");
    }

    if (enabled) {
      start();
    } else {
      stop();
    }

    return () => {
      cancelled = true;
      stop();
    };
    // deviceId change should restart the pipeline
  }, [enabled, deviceId, uploadSegment, refreshDevices]);

  return {
    devices,
    deviceId,
    setDeviceId,
    enabled,
    setEnabled,
    isSpeaking,
    analyser,
    status,
    error,
  };
}
