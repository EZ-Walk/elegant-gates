import React from "react";

const MESSAGE_TYPE_STYLES = {
  distress: { bg: "#3d0f0f", border: "#e53935", badge: "#e53935", label: "DISTRESS" },
  safety:   { bg: "#2d1f00", border: "#fb8c00", badge: "#fb8c00", label: "SAFETY"  },
  routine:  { bg: "#0d2b1a", border: "#43a047", badge: "#43a047", label: "ROUTINE" },
  traffic:  { bg: "#0d1f35", border: "#1e88e5", badge: "#1e88e5", label: "TRAFFIC" },
};

const defaultStyle = { bg: "#1a1e28", border: "#444", badge: "#888", label: "UNKNOWN" };

function formatTime(isoString) {
  try {
    return new Date(isoString).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "--:--:--";
  }
}

function TypeBadge({ type }) {
  const style = MESSAGE_TYPE_STYLES[type] || defaultStyle;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 7px",
        borderRadius: 3,
        backgroundColor: style.badge,
        color: "#fff",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        flexShrink: 0,
      }}
    >
      {style.label}
    </span>
  );
}

function CommunicationItem({ comm, isSelected, onClick }) {
  const style = MESSAGE_TYPE_STYLES[comm.message_type] || defaultStyle;

  return (
    <div
      onClick={onClick}
      style={{
        padding: "10px 12px",
        marginBottom: 6,
        borderRadius: 6,
        backgroundColor: isSelected ? style.bg : "#12161f",
        borderLeft: `3px solid ${style.border}`,
        cursor: "pointer",
        transition: "background-color 0.15s",
        outline: isSelected ? `1px solid ${style.border}` : "none",
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.backgroundColor = "#1a1e28";
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.backgroundColor = "#12161f";
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
        <TypeBadge type={comm.message_type} />
        {comm.vessel && (
          <span style={{ fontSize: 12, fontWeight: 600, color: "#89b4fa", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {comm.vessel}
          </span>
        )}
        {comm.callsign && (
          <span style={{ fontSize: 11, color: "#a6adc8", fontFamily: "monospace", flexShrink: 0 }}>
            {comm.callsign}
          </span>
        )}
        {comm.channel && (
          <span style={{ fontSize: 11, color: "#a6adc8", flexShrink: 0 }}>
            CH {comm.channel}
          </span>
        )}
      </div>

      {/* Summary */}
      <p
        style={{
          fontSize: 12,
          color: "#cdd6f4",
          lineHeight: 1.4,
          marginBottom: 4,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
        }}
      >
        {comm.summary || comm.text}
      </p>

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#6c7086" }}>{formatTime(comm.timestamp)}</span>
        {comm.lat != null && comm.lon != null && (
          <span style={{ fontSize: 10, color: "#6c7086" }}>
            {Number(comm.lat).toFixed(4)}, {Number(comm.lon).toFixed(4)}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * CommunicationList
 *
 * @param {Object} props
 * @param {Array}  props.communications - Array of communication objects
 * @param {string|null} props.selectedId - ID of currently selected communication
 * @param {Function} props.onSelect - Callback(comm) when an item is clicked
 */
export function CommunicationList({ communications, selectedId, onSelect }) {
  if (!communications || communications.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: "center",
          color: "#6c7086",
          fontSize: 13,
        }}
      >
        <div style={{ marginBottom: 8, fontSize: 24 }}>📻</div>
        <div>No communications yet.</div>
        <div style={{ marginTop: 4, fontSize: 11 }}>Waiting for radio traffic...</div>
      </div>
    );
  }

  return (
    <div style={{ overflowY: "auto", flex: 1, padding: "0 12px 12px" }}>
      {communications.map((comm) => (
        <CommunicationItem
          key={comm.id}
          comm={comm}
          isSelected={comm.id === selectedId}
          onClick={() => onSelect(comm)}
        />
      ))}
    </div>
  );
}

export default CommunicationList;
