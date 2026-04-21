import React from "react";

const styles = {
  root: {
    padding: "10px 16px",
    borderBottom: "1px solid #1e2130",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    fontSize: 11,
    color: "#a6adc8",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  label: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "#6c7086",
  },
  select: {
    flex: 1,
    background: "#12161f",
    color: "#cdd6f4",
    border: "1px solid #1e2130",
    borderRadius: 4,
    padding: "4px 6px",
    fontSize: 11,
    minWidth: 0,
  },
  button: (active) => ({
    background: active ? "#43a047" : "#12161f",
    color: active ? "#fff" : "#cdd6f4",
    border: `1px solid ${active ? "#43a047" : "#1e2130"}`,
    borderRadius: 4,
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  }),
  statusDot: (status) => ({
    display: "inline-block",
    width: 7,
    height: 7,
    borderRadius: "50%",
    backgroundColor:
      status === "listening" ? "#43a047"
      : status === "starting" ? "#fb8c00"
      : status === "error" ? "#e53935"
      : "#6c7086",
  }),
  error: {
    color: "#ff8a80",
    fontSize: 10,
  },
};

export function CaptureControls({
  devices,
  deviceId,
  setDeviceId,
  enabled,
  setEnabled,
  status,
  error,
}) {
  return (
    <div style={styles.root}>
      <div style={styles.row}>
        <span style={styles.label}>Input</span>
        <select
          style={styles.select}
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
        >
          <option value="">Default</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Device ${d.deviceId.slice(0, 6)}`}
            </option>
          ))}
        </select>
      </div>
      <div style={styles.row}>
        <span style={styles.statusDot(status)} />
        <span style={{ flex: 1 }}>
          {status === "listening" ? "Listening"
            : status === "starting" ? "Starting…"
            : status === "error" ? "Error"
            : "Off"}
        </span>
        <button
          style={styles.button(enabled)}
          onClick={() => setEnabled(!enabled)}
        >
          {enabled ? "Stop" : "Capture"}
        </button>
      </div>
      {error && <div style={styles.error}>{error}</div>}
    </div>
  );
}
