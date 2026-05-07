import React, { useMemo, useState } from "react";
import { useEnergyVadCapture } from "../hooks/useEnergyVadCapture.js";

const panel = {
  marginTop: 12,
  padding: "12px 16px",
  borderTop: "1px solid #1e2130",
  flexShrink: 0,
};
const label = { fontSize: 11, color: "#6c7086", marginBottom: 6 };
const row = { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 };
const meterWrap = {
  flex: 1,
  height: 6,
  background: "#1e2130",
  borderRadius: 3,
  overflow: "hidden",
};
const meterFill = (w, hot) => ({
  width: `${Math.round(w * 100)}%`,
  height: "100%",
  background: hot ? "#f9e2af" : "#45475a",
  transition: "width 50ms linear",
});
const err = { fontSize: 11, color: "#f38ba8", marginTop: 6 };

export function BrowserCapturePanel({ apiBase }) {
  const [captureOn, setCaptureOn] = useState(false);
  const vadOptions = useMemo(() => ({}), []);

  const {
    devices,
    deviceId,
    setDeviceId,
    speaking,
    listening,
    level,
    segmentsSaved,
    lastError,
    clearError,
  } = useEnergyVadCapture({ apiBase, enabled: captureOn, options: vadOptions });

  return (
    <div style={panel}>
      <div style={label}>Browser capture (energy VAD)</div>
      <label style={{ ...row, cursor: "pointer", marginBottom: 10 }}>
        <input
          type="checkbox"
          checked={captureOn}
          onChange={(e) => {
            clearError();
            setCaptureOn(e.target.checked);
          }}
        />
        <span style={{ fontSize: 12, color: "#cdd6f4" }}>
          {captureOn ? (listening ? "Listening…" : "Starting…") : "Off"}
          {captureOn && listening && (speaking ? " · speaking" : " · idle")}
        </span>
      </label>

      {captureOn && (
        <>
          <div style={row}>
            <span style={{ fontSize: 10, color: "#6c7086", width: 42 }}>Input</span>
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              style={{
                flex: 1,
                fontSize: 11,
                background: "#181825",
                color: "#cdd6f4",
                border: "1px solid #313244",
                borderRadius: 4,
                padding: "4px 6px",
              }}
            >
              <option value="">Default microphone</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Device ${d.deviceId.slice(0, 8)}…`}
                </option>
              ))}
            </select>
          </div>
          <div style={row}>
            <span style={{ fontSize: 10, color: "#6c7086", width: 42 }}>Level</span>
            <div style={meterWrap}>
              <div style={meterFill(level, speaking)} />
            </div>
          </div>
          <div style={{ fontSize: 10, color: "#6c7086" }}>
            Saved segments: {segmentsSaved} → <code style={{ color: "#89b4fa" }}>shared/recordings/</code>
          </div>
        </>
      )}

      {lastError && <div style={err}>{lastError}</div>}
    </div>
  );
}
