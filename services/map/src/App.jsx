import React, { useEffect, useRef, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import { CommunicationList } from "./components/CommunicationList.jsx";
import { useSSE } from "./hooks/useSSE.js";

// Mapbox token injected at build time via Vite
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || "";

// San Francisco Bay
const DEFAULT_CENTER = [-122.4, 37.8];
const DEFAULT_ZOOM = 20;

const MESSAGE_TYPE_COLORS = {
  distress: "#e53935",
  safety:   "#fb8c00",
  routine:  "#43a047",
  traffic:  "#1e88e5",
};

const styles = {
  root: {
    display: "flex",
    height: "100vh",
    width: "100vw",
    overflow: "hidden",
    background: "#0a0e14",
  },
  sidebar: {
    width: 340,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    background: "#0e1118",
    borderRight: "1px solid #1e2130",
    zIndex: 10,
  },
  sidebarHeader: {
    padding: "16px 16px 12px",
    borderBottom: "1px solid #1e2130",
    flexShrink: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    color: "#89b4fa",
    letterSpacing: "0.04em",
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 11,
    color: "#6c7086",
  },
  statusDot: (connected) => ({
    display: "inline-block",
    width: 7,
    height: 7,
    borderRadius: "50%",
    backgroundColor: connected ? "#43a047" : "#e53935",
    marginRight: 5,
    verticalAlign: "middle",
  }),
  mapContainer: {
    flex: 1,
    position: "relative",
  },
  errorBanner: {
    position: "absolute",
    top: 12,
    left: "50%",
    transform: "translateX(-50%)",
    background: "#3d0f0f",
    color: "#ff8a80",
    padding: "6px 16px",
    borderRadius: 6,
    fontSize: 12,
    zIndex: 100,
    border: "1px solid #e53935",
  },
};

function createMarkerEl(type) {
  const color = MESSAGE_TYPE_COLORS[type] || "#888";
  const el = document.createElement("div");
  el.style.cssText = `
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: ${color};
    border: 2px solid #fff;
    box-shadow: 0 0 6px ${color}99;
    cursor: pointer;
  `;
  return el;
}

function buildPopupHTML(comm) {
  const typeColor = MESSAGE_TYPE_COLORS[comm.message_type] || "#888";
  const vessel = comm.vessel || "Unknown vessel";
  const callsign = comm.callsign ? ` (${comm.callsign})` : "";
  const channel = comm.channel ? `CH ${comm.channel}` : "";
  const time = comm.timestamp
    ? new Date(comm.timestamp).toLocaleString()
    : "";

  return `
    <div style="font-family:-apple-system,sans-serif;min-width:200px;max-width:280px;color:#cdd6f4;background:#12161f;border-radius:6px;overflow:hidden;padding:12px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="background:${typeColor};color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:3px;text-transform:uppercase;">${comm.message_type || "unknown"}</span>
        ${channel ? `<span style="font-size:11px;color:#a6adc8;">${channel}</span>` : ""}
      </div>
      <div style="font-weight:600;font-size:14px;color:#89b4fa;margin-bottom:4px;">${vessel}${callsign}</div>
      <p style="font-size:12px;color:#cdd6f4;margin:0 0 8px;line-height:1.4;">${comm.summary || comm.text || ""}</p>
      ${time ? `<div style="font-size:10px;color:#6c7086;">${time}</div>` : ""}
    </div>
  `;
}

export default function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  // Map from comm ID -> mapboxgl.Marker
  const markersRef = useRef({});

  const [communications, setCommunications] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [mapReady, setMapReady] = useState(false);

  const { events: sseEvents, connected, error: sseError } = useSSE("/api/stream");

  // -------------------------------------------------------------------------
  // Initialize Mapbox
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    map.addControl(
      new mapboxgl.ScaleControl({ maxWidth: 120, unit: "nautical" }),
      "bottom-right"
    );

    map.on("load", () => {
      mapRef.current = map;
      setMapReady(true);
    });

    return () => {
      // Remove all markers
      Object.values(markersRef.current).forEach((m) => m.remove());
      markersRef.current = {};
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Add or update a marker for a communication
  // -------------------------------------------------------------------------
  const addMarker = useCallback((comm) => {
    if (!mapRef.current || comm.lat == null || comm.lon == null) return;

    // Remove existing marker for this ID
    if (markersRef.current[comm.id]) {
      markersRef.current[comm.id].remove();
    }

    const el = createMarkerEl(comm.message_type);
    const popup = new mapboxgl.Popup({ offset: 12, closeButton: true })
      .setHTML(buildPopupHTML(comm));

    const marker = new mapboxgl.Marker({ element: el })
      .setLngLat([comm.lon, comm.lat])
      .setPopup(popup)
      .addTo(mapRef.current);

    el.addEventListener("click", () => {
      setSelectedId(comm.id);
    });

    markersRef.current[comm.id] = marker;
  }, []);

  // -------------------------------------------------------------------------
  // Fetch initial communications on load
  // -------------------------------------------------------------------------
  useEffect(() => {
    fetch("/api/communications")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setCommunications(data);
        }
      })
      .catch((err) => console.error("Failed to fetch communications:", err));
  }, []);

  // -------------------------------------------------------------------------
  // Add markers for initial communications once map is ready
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mapReady) return;
    communications.forEach(addMarker);
  }, [mapReady, communications, addMarker]);

  // -------------------------------------------------------------------------
  // Handle incoming SSE events
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!sseEvents || sseEvents.length === 0) return;
    const latest = sseEvents[0]; // useSSE prepends new events
    if (!latest || !latest.id) return;

    setCommunications((prev) => {
      // Avoid duplicates
      if (prev.some((c) => c.id === latest.id)) return prev;
      return [latest, ...prev].slice(0, 100);
    });

    if (mapReady) {
      addMarker(latest);
    }
  }, [sseEvents, mapReady, addMarker]);

  // -------------------------------------------------------------------------
  // Handle sidebar item selection — fly to marker if it has coordinates
  // -------------------------------------------------------------------------
  const handleSelect = useCallback((comm) => {
    setSelectedId(comm.id);

    if (comm.lat != null && comm.lon != null && mapRef.current) {
      mapRef.current.flyTo({
        center: [comm.lon, comm.lat],
        zoom: Math.max(mapRef.current.getZoom(), 12),
        duration: 1000,
      });

      // Open the marker's popup
      const marker = markersRef.current[comm.id];
      if (marker) {
        marker.togglePopup();
      }
    }
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div style={styles.root}>
      {/* Sidebar */}
      <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <div style={styles.title}>VHF14 Monitor</div>
          <div style={styles.subtitle}>
            <span style={styles.statusDot(connected)} />
            {connected ? "Live" : "Reconnecting..."}
            {" · "}
            {communications.length} communication{communications.length !== 1 ? "s" : ""}
          </div>
        </div>

        <CommunicationList
          communications={communications}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
      </aside>

      {/* Map */}
      <div style={styles.mapContainer}>
        <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />
        {sseError && (
          <div style={styles.errorBanner}>{sseError}</div>
        )}
      </div>
    </div>
  );
}
