import { usePerception } from "../../context/PerceptionContext";

const COLORS = { LOW: "#22c55e", MEDIUM: "#f59e0b", HIGH: "#ef4444" };

/** Small Dashboard overlay with the latest collision assessment from the live perception loop. */
function CollisionRiskBadge() {
  const { latest, liveActive } = usePerception();
  const c = latest?.collision?.estimated || latest?.collision?.ground_truth;
  const trackId = latest?.tracking?.tracks?.[0]?.track_id;
  const color = COLORS[c?.risk_level] || "#475569";

  return (
    <div
      style={{
        position: "absolute",
        top: "64px",
        right: "20px",
        zIndex: 10,
        background: "#111a2c",
        border: `1px solid ${color}`,
        borderRadius: "8px",
        padding: "10px 14px",
        color: "#e2e8f0",
        fontSize: "12px",
        minWidth: "190px",
        boxShadow: c?.risk_level === "HIGH" ? `0 0 14px ${color}` : "none",
      }}
      title="From the live perception loop (runs in the background on every page): Kalman-filtered relative motion -> TTC / CPA"
    >
      <div style={{ fontSize: "10px", color: "#64748b", letterSpacing: "0.5px" }}>COLLISION RISK</div>
      <div style={{ fontSize: "20px", fontWeight: 800, color }}>{c?.risk_level || (liveActive ? "WAITING" : "OFF")}</div>
      {c ? (
        <div style={{ fontFamily: "monospace", color: "#94a3b8", lineHeight: 1.5 }}>
          TTC {c.ttc_s == null ? "∞" : `${c.ttc_s} s`} · CPA {c.d_cpa_m} m
          <br />
          t_CPA {c.t_cpa_s} s · range {c.range_m} m
          {trackId && (
            <>
              <br />
              target {trackId}
            </>
          )}
        </div>
      ) : (
        <div style={{ color: "#64748b" }}>
          {liveActive ? "Waiting for the first perception step…" : "Press Play to start the mission (live perception starts with it)"}
        </div>
      )}
    </div>
  );
}

export default CollisionRiskBadge;
