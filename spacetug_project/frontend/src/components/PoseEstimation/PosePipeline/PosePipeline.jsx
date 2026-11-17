import { useState } from "react";
import "./PosePipeline.css";
import { useSensor } from "../../../context/SensorContext";
import { FaTable, FaBolt } from "react-icons/fa";

const fmt = (v, d = 3) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(d) : "--";
};

const SOLVER_LABELS = {
  ITERATIVE: "solvePnP (Iterative)",
  EPNP: "EPnP",
  SQPNP: "SQPnP",
};

/** One comparison row: label | estimated | ground truth | difference */
function CompareRow({ badge, badgeClass, label, est, gt, unit = "", digits = 2, angle = false }) {
  const e = Number(est);
  const g = Number(gt);
  let diff = null;
  if (Number.isFinite(e) && Number.isFinite(g)) {
    diff = e - g;
    if (angle) diff = ((diff + 540) % 360) - 180; // wrap to [-180, 180)
  }
  return (
    <div className="rq-row cmp-row">
      <span className={`rq-badge ${badgeClass}`}>{badge}</span>
      <span className="rq-label">{label}</span>
      <strong className="rq-value">{fmt(est, digits)}{unit}</strong>
      <span className="rq-subval gt-val">{fmt(gt, digits)}{unit}</span>
      <span className="rq-subval diff-val">{diff == null ? "--" : `${diff >= 0 ? "+" : ""}${diff.toFixed(digits)}`}</span>
    </div>
  );
}

function PosePipeline({ algorithm = "ITERATIVE", isLiveStreaming = true }) {
  const [activeTab, setActiveTab] = useState("euler");
  const { poseResult, poseError, capturedFrame } = useSensor();

  const solved = Boolean(poseResult?.success);
  const est = solved ? poseResult : null;
  const gt = poseResult?.ground_truth || null;
  const err = poseResult?.errors_vs_gt || null;

  const R = est?.rotation_matrix;
  const t = est?.position;
  const matrixRows = [0, 1, 2].map((i) => ({
    row: `Row ${i + 1}`,
    r: R ? R[i].map((x) => fmt(x, 4)) : ["--", "--", "--"],
    t: t ? `${fmt([t.x, t.y, t.z][i], 3)} m` : "--",
  }));

  return (
    <div className="pose-pipeline-engine">
      {/* 1. ESTIMATED [R | t] FROM OPENCV */}
      <div className="pipeline-card live-matrix-card">
        <div className="card-header-row">
          <div className="header-title-badge">
            <FaTable className="badge-icon" />
            <span>ESTIMATED [R | t] (OPENCV CAMERA FRAME)</span>
          </div>
          <span className="matrix-dim-tag">{SOLVER_LABELS[est?.method] || SOLVER_LABELS[algorithm] || algorithm}</span>
        </div>

        <div className="matrix-table-container">
          <table className="orbitron-matrix-table">
            <thead>
              <tr>
                <th>ROW</th>
                <th>R1</th>
                <th>R2</th>
                <th>R3</th>
                <th>T</th>
              </tr>
            </thead>
            <tbody>
              {matrixRows.map((r) => (
                <tr key={r.row}>
                  <td className="row-label">{r.row}</td>
                  <td className="num-val">{r.r[0]}</td>
                  <td className="num-val">{r.r[1]}</td>
                  <td className="num-val">{r.r[2]}</td>
                  <td className="t-val">{r.t}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!solved && (
          <p className="pipeline-hint">
            {poseError
              ? `Pose failed: ${poseError}`
              : capturedFrame
              ? "Click Estimate Pose to run solvePnP on the captured frame."
              : "Capture a frame on the Sensors page, then estimate the pose here."}
          </p>
        )}
      </div>

      {/* 2. ESTIMATED vs GROUND TRUTH */}
      <div className="pipeline-card transform-inspector-card">
        <div className="inspector-tabs">
          <button
            type="button"
            className={`inspector-tab-btn ${activeTab === "euler" ? "active" : ""}`}
            onClick={() => setActiveTab("euler")}
          >
            Euler + Position
          </button>
          <button
            type="button"
            className={`inspector-tab-btn ${activeTab === "quaternion" ? "active" : ""}`}
            onClick={() => setActiveTab("quaternion")}
          >
            Quaternion
          </button>
        </div>

        <div className="rq-structured-grid">
          <div className="rq-row cmp-row cmp-head">
            <span className="rq-badge" />
            <span className="rq-label" />
            <span className="rq-value">Estimated</span>
            <span className="rq-subval gt-val">Ground Truth (Sim)</span>
            <span className="rq-subval diff-val">Δ</span>
          </div>

          {activeTab === "euler" && (
            <>
              <CompareRow badge="R" badgeClass="r-badge" label="ROLL" est={est?.attitude?.roll} gt={gt?.attitude?.roll} unit="°" angle />
              <CompareRow badge="P" badgeClass="r-badge" label="PITCH" est={est?.attitude?.pitch} gt={gt?.attitude?.pitch} unit="°" angle />
              <CompareRow badge="Y" badgeClass="r-badge" label="YAW" est={est?.attitude?.yaw} gt={gt?.attitude?.yaw} unit="°" angle />
              <CompareRow badge="X" badgeClass="t-badge" label="X" est={est?.position?.x} gt={gt?.position?.x} unit=" m" digits={3} />
              <CompareRow badge="Y" badgeClass="t-badge" label="Y" est={est?.position?.y} gt={gt?.position?.y} unit=" m" digits={3} />
              <CompareRow badge="Z" badgeClass="t-badge" label="Z" est={est?.position?.z} gt={gt?.position?.z} unit=" m" digits={3} />
              <CompareRow badge="R" badgeClass="t-badge" label="RANGE" est={est?.distance_m} gt={gt?.distance_m} unit=" m" digits={3} />
            </>
          )}

          {activeTab === "quaternion" &&
            ["qw", "qx", "qy", "qz"].map((k) => (
              <CompareRow
                key={k}
                badge={k[1].toUpperCase()}
                badgeClass="q-badge"
                label={k}
                est={est?.quaternion?.[k]}
                gt={gt?.quaternion?.[k]}
                digits={4}
              />
            ))}
        </div>
      </div>

      {/* 3. SOLVER METRICS (all computed by the backend for this frame) */}
      <div className="pipeline-card performance-analytics-card">
        <div className="card-header-row">
          <div className="header-title-badge">
            <FaBolt className="badge-icon" />
            <span>SOLVER METRICS</span>
          </div>
          <span className="live-status-pulse">{isLiveStreaming ? "● LIVE" : "❚❚ STANDBY"}</span>
        </div>

        <div className="metrics-2x2-grid">
          <div className="metric-cell">
            <span className="cell-label">REPROJECTION RMSE</span>
            <strong className="cell-val green-val">{solved ? `${fmt(est.reprojection_rmse_px, 3)} px` : "--"}</strong>
          </div>
          <div className="metric-cell">
            <span className="cell-label">SOLVE TIME</span>
            <strong className="cell-val yellow-val">{solved ? `${fmt(est.solve_time_ms, 2)} ms` : "--"}</strong>
          </div>
          <div className="metric-cell">
            <span className="cell-label">ROTATION ERROR</span>
            <strong className="cell-val cyan-val">{err?.rotation_error_deg != null ? `${fmt(err.rotation_error_deg, 3)}°` : "--"}</strong>
          </div>
          <div className="metric-cell">
            <span className="cell-label">TRANSLATION ERROR</span>
            <strong className="cell-val cyan-val">
              {err?.translation_error_m != null
                ? `${fmt(err.translation_error_m, 4)} m (${fmt(err.translation_error_pct, 2)}%)`
                : "--"}
            </strong>
          </div>
          <div className="metric-cell">
            <span className="cell-label">LANDMARKS USED</span>
            <strong className="cell-val">{solved ? est.landmarks_used : "--"}</strong>
          </div>
          <div className="metric-cell">
            <span className="cell-label">RANGE ERROR</span>
            <strong className="cell-val">{err?.range_error_m != null ? `${fmt(err.range_error_m, 4)} m` : "--"}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PosePipeline;
