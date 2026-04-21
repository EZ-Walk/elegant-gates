import React, { useEffect, useRef, useState } from "react";

const BAR_COUNT = 24;
const FADE_MS = 250;

const styles = {
  root: (visible) => ({
    position: "fixed",
    bottom: 28,
    left: "50%",
    transform: `translateX(-50%) translateY(${visible ? 0 : 8}px)`,
    opacity: visible ? 1 : 0,
    transition: `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease`,
    pointerEvents: "none",
    zIndex: 1000,
    background: "rgba(18, 22, 31, 0.92)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(137, 180, 250, 0.3)",
    borderRadius: 999,
    padding: "10px 20px",
    display: "flex",
    alignItems: "center",
    gap: 12,
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
  }),
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#e53935",
    boxShadow: "0 0 8px #e53935",
    animation: "vhf-pulse 1.2s ease-in-out infinite",
  },
  bars: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    height: 28,
  },
  label: {
    fontFamily: "-apple-system, sans-serif",
    fontSize: 11,
    fontWeight: 600,
    color: "#89b4fa",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
};

// Keyframes injected once for the dot pulse
if (typeof document !== "undefined" && !document.getElementById("vhf-speech-modal-css")) {
  const style = document.createElement("style");
  style.id = "vhf-speech-modal-css";
  style.textContent = `
    @keyframes vhf-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
  `;
  document.head.appendChild(style);
}

export function SpeechModal({ analyser, isSpeaking }) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  // Mount/unmount with fade-in/out
  useEffect(() => {
    if (isSpeaking) {
      setMounted(true);
      // Next frame -> trigger fade-in transition
      requestAnimationFrame(() => setVisible(true));
    } else if (mounted) {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), FADE_MS);
      return () => clearTimeout(t);
    }
  }, [isSpeaking, mounted]);

  // Drive the bars from the analyser
  useEffect(() => {
    if (!mounted || !analyser || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const width = BAR_COUNT * 4 + (BAR_COUNT - 1) * 2; // bar width 4, gap 2
    const height = 28;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    const freqs = new Uint8Array(analyser.frequencyBinCount);

    const render = () => {
      analyser.getByteFrequencyData(freqs);
      ctx.clearRect(0, 0, width, height);

      // Pick BAR_COUNT roughly log-spaced bins
      const step = freqs.length / BAR_COUNT;
      for (let i = 0; i < BAR_COUNT; i++) {
        const v = freqs[Math.floor(i * step)] / 255;
        const barH = Math.max(2, v * height);
        const x = i * 6;
        const y = (height - barH) / 2;
        ctx.fillStyle = `rgba(137, 180, 250, ${0.5 + v * 0.5})`;
        ctx.fillRect(x, y, 4, barH);
      }

      rafRef.current = requestAnimationFrame(render);
    };
    render();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [mounted, analyser]);

  if (!mounted) return null;

  return (
    <div style={styles.root(visible)}>
      <span style={styles.dot} />
      <div style={styles.bars}>
        <canvas ref={canvasRef} />
      </div>
      <span style={styles.label}>Listening</span>
    </div>
  );
}
