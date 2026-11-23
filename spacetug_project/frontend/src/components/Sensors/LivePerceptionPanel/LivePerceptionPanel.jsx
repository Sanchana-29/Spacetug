import { usePerception } from "../../../context/PerceptionContext";
import { useSimulation } from "../../../context/SimulationContext";
import "./LivePerceptionPanel.css";

const f = (v, d = 2, unit = "") =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? "--" : `${Number(v).toFixed(d)}${unit}`;

const RISK_COLORS = { LOW: "#22c55e", "DOCKING CORRIDOR": "#38bdf8", MEDIUM: "#f59e0b", HIGH: "#ef4444" };

/** Controls + live readout of tracking, pose, motion and collision (Sensors page). */
function LivePerceptionPanel() {
  const {
    liveActive,
    setLiveActive,
    liveRate,
    setLiveRate,
    liveNoise,
    setLiveNoise,
    safetyRadius,
    setSafetyRadius,
    latest,
    history,
    lastError,
    resetPerception,
    libraryViews,
  } = usePerception();
  const { isRunning } = useSimulation();

  const trk = latest?.tracking;
  const t0 = trk?.tracks?.[0];
  const pose = latest?.pose;
  const mEst = latest?.motion?.estimated;
  const mGt = latest?.motion?.ground_truth;
  const cEst = latest?.collision?.estimated;
  const cGt = latest?.collision?.ground_truth;
  const risk = cEst?.risk_level || cGt?.risk_level;

  return (
    <div className="live-perception-panel">
      <div className="lpp-controls">
        <button
          type="button"
          className={`lpp-toggle ${liveActive ? "on" : ""}`}
          onClick={() => setLiveActive(!liveActive)}
          title="Run detection + tracking + pose + motion + collision on the live sensor feed"
        >
          {liveActive ? "■ STOP LIVE PERCEPTION" : "▶ START LIVE PERCEPTION"}
        </button>
        <label>
          Rate
          <select value={liveRate} onChange={(e) => setLiveRate(Number(e.target.value))}>
            <option value={1}>1 FPS</option>
            <option value={2}>2 FPS</option>
            <option value={3}>3 FPS</option>
            <option value={4}>4 FPS</option>
          </select>
        </label>
        <label title="Gaussian noise added to the 2D landmarks before solvePnP">
          Noise σ
          <select value={liveNoise} onChange={(e) => setLiveNoise(Number(e.target.value))}>
            <option value={0}>0 px</option>
            <option value={1}>1 px</option>
            <option value={2}>2 px</option>
            <option value={3}>3 px</option>
          </select>
        </label>
        <label title="Collision safety radius">
          Safety R
          <select value={safetyRadius} onChange={(e) => setSafetyRadius(Number(e.target.value))}>
            {![1, 1.3, 1.5, 2, 3, 5].includes(Number(safetyRadius)) && (
              <option value={safetyRadius}>{safetyRadius} m</option>
            )}
            <option value={1}>1 m</option>
            <option value={1.3}>1.3 m</option>
            <option value={1.5}>1.5 m</option>
            <option value={2}>2 m</option>
            <option value={3}>3 m</option>
            <option value={5}>5 m</option>
          </select>
        </label>
        <button type="button" className="lpp-reset" onClick={resetPerception}>
          Reset
        </button>
        <span className="lpp-meta">
          {history.length} samples
          {liveActive ? " · runs on every page" : ""}
          {libraryViews != null ? ` · ORB/SIFT library ${libraryViews} views` : ""}
          {!isRunning && liveActive ? " · simulation paused: press Play on the Dashboard" : ""}
          {lastError ? ` · ⚠ ${lastError}` : ""}
        </span>
      </div>

      <div className="lpp-grid">
        <div className="lpp-cell">
          <span className="lpp-title">TRACKING (YOLOv8n + SORT)</span>
          <strong>{t0 ? t0.track_id : "--"}</strong>
          <span>
            age {t0?.age_frames ?? "--"} · det {trk?.detections ?? "--"} · ID switches {trk?.id_switches ?? "--"}
          </span>
          <span>ID consistency {f(trk?.id_consistency_pct, 1, "%")}</span>
        </div>

        <div className="lpp-cell">
          <span className="lpp-title">POSE (solvePnP vs truth)</span>
          <strong>{pose?.success ? `${f(pose.distance_m, 3)} m` : "--"}</strong>
          <span>truth {f(mGt?.range_m, 3, " m")}</span>
          <span>
            rot err {f(pose?.errors_vs_gt?.rotation_error_deg, 2, "°")} · RMSE {f(pose?.reprojection_rmse_px, 2, " px")}
          </span>
        </div>

        <div className="lpp-cell">
          <span className="lpp-title">RELATIVE MOTION (Kalman)</span>
          <strong>{f(mEst?.speed_filtered_mps, 4, " m/s")}</strong>
          <span>raw {f(mEst?.speed_raw_mps, 4)} · truth {f(mGt?.speed_raw_mps, 4)}</span>
          <span>
            tumble {f(mEst?.tumbling_rate_filtered_dps, 2, "°/s")} · truth {f(mGt?.tumbling_rate_raw_dps, 2, "°/s")}
          </span>
        </div>

        <div className="lpp-cell" style={{ borderColor: RISK_COLORS[risk] || "#24324d" }}>
          <span className="lpp-title">COLLISION RISK (TTC / CPA)</span>
          <strong style={{ color: RISK_COLORS[risk] || "#94a3b8" }}>{risk || "--"}</strong>
          <span>
            TTC {cEst ? (cEst.ttc_s == null ? "∞ (opening)" : `${f(cEst.ttc_s, 1)} s`) : "--"}
          </span>
          <span>
            CPA {f(cEst?.d_cpa_m, 2, " m")} in {f(cEst?.t_cpa_s, 1, " s")} · truth {f(cGt?.d_cpa_m, 2, " m")}
          </span>
        </div>
      </div>
    </div>
  );
}

export default LivePerceptionPanel;
