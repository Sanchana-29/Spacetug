
import { useState } from "react";
import { useSimulation } from "../../../context/SimulationContext";
import "./TelemetryLogs.css";

function TelemetryLogs() {
  const { missionEvents, setMissionEvents } = useSimulation();
  const [filterType, setFilterType] = useState("ALL");

  const formatTime = (seconds = 0) => {
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    return [hours, minutes, secs]
      .map((value) => String(value).padStart(2, "0"))
      .join(":");
  };

  // Keep up to 200 events, newest first
  const events = missionEvents.slice(0, 200);

  const filtered = filterType === "ALL"
    ? events
    : events.filter((ev) => ev.type?.toUpperCase() === filterType);

  return (
    <div className="telemetry-logs">
      <div className="logs-header">
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <h3>Mission Events</h3>
          <span style={{ fontSize: "11px", color: "#64748b" }}>
            ({filtered.length} events, newest first)
          </span>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            style={{
              background: "#091222",
              color: "#94a3b8",
              border: "1px solid #1e293b",
              borderRadius: "4px",
              padding: "4px 8px",
              fontSize: "11px",
              cursor: "pointer",
            }}
          >
            <option value="ALL">All Types</option>
            <option value="SUCCESS">SUCCESS</option>
            <option value="WARNING">WARNING</option>
            <option value="INFO">INFO</option>
          </select>

          <button
            type="button"
            onClick={() => setMissionEvents([])}
            style={{
              background: "#1e293b",
              color: "#e2e8f0",
              border: "1px solid #334155",
              borderRadius: "4px",
              padding: "4px 10px",
              fontSize: "11px",
              cursor: "pointer",
              fontWeight: "600",
            }}
          >
            Clear Events
          </button>
        </div>
      </div>

      <div className="logs-body" style={{ maxHeight: "280px", overflowY: "auto" }}>
        {filtered.length === 0 ? (
          <p style={{ color: "#64748b", padding: "20px", textAlign: "center" }}>
            No mission events recorded yet.
          </p>
        ) : (
          filtered.map((event) => (
            <div className="log-entry" key={event.id}>
              <span className="log-time">
                {event.time != null ? formatTime(event.time) : (event.timestamp || "--:--:--")}
              </span>

              <span
                className={`log-type ${event.type?.toLowerCase() || "info"}`}
                style={
                  event.type === "WARNING"
                    ? { color: "#f59e0b", background: "rgba(245, 158, 11, 0.15)", padding: "2px 6px", borderRadius: "3px", textAlign: "center" }
                    : event.type === "SUCCESS"
                    ? { color: "#10b981", background: "rgba(16, 185, 129, 0.15)", padding: "2px 6px", borderRadius: "3px", textAlign: "center" }
                    : { color: "#38bdf8", background: "rgba(56, 189, 248, 0.15)", padding: "2px 6px", borderRadius: "3px", textAlign: "center" }
                }
              >
                [{event.type || "INFO"}]
              </span>

              <span className="log-message" style={{ fontWeight: 500 }}>
                {event.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default TelemetryLogs;
