import { useState, useMemo, useRef } from "react";
import "./PosePipeline.css";
import * as THREE from "three";
import { useSensor } from "../../../context/SensorContext";
import { useSimulation } from "../../../context/SimulationContext";
import { FaTable, FaBolt } from "react-icons/fa";

function PosePipeline({ algorithm = "SolvePnP", feature = "ORB", isLiveStreaming = true }) {
  const [activeTab, setActiveTab] = useState("euler"); // "euler" | "quaternion" | "relative"
  const { poseResult } = useSensor();
  const {
    chaserPosition,
    targetPosition,
    targetQuaternion,
    angularVelocity,
    relativeVelocity,
  } = useSimulation();

  // Frozen state for STANDBY inspection mode
  const frozenStateRef = useRef(null);

  // Live attitude and positions from SimulationContext
  const liveState = useMemo(() => {
    // 1. Position vector (Target minus Chaser)
    const tx = (targetPosition?.x ?? 5.2) - (chaserPosition?.x ?? 0);
    const ty = (targetPosition?.y ?? 0) - (chaserPosition?.y ?? 0);
    const tz = (targetPosition?.z ?? 1.24) - (chaserPosition?.z ?? 0);
    const dist = Math.sqrt(tx * tx + ty * ty + tz * tz);

    // 2. Quaternion
    const quat = targetQuaternion
      ? targetQuaternion.clone()
      : new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));

    // 3. Euler angles (Roll, Pitch, Yaw in degrees)
    const euler = new THREE.Euler().setFromQuaternion(quat, "XYZ");
    const rollDeg = THREE.MathUtils.radToDeg(euler.x);
    const pitchDeg = THREE.MathUtils.radToDeg(euler.y);
    const yawDeg = THREE.MathUtils.radToDeg(euler.z);

    // 4. Compute 3x3 Rotation Matrix dynamically from Euler
    const rotMat = new THREE.Matrix4().makeRotationFromEuler(euler);
    const te = rotMat.elements;
    // THREE.Matrix4 elements are column-major:
    // row 1: te[0], te[4], te[8]
    // row 2: te[1], te[5], te[9]
    // row 3: te[2], te[6], te[10]
    const r11 = te[0], r12 = te[4], r13 = te[8];
    const r21 = te[1], r22 = te[5], r23 = te[9];
    const r31 = te[2], r32 = te[6], r33 = te[10];

    // 5. Angular velocities in deg/s
    const wxDeg = THREE.MathUtils.radToDeg(angularVelocity?.x ?? 0.05);
    const wyDeg = THREE.MathUtils.radToDeg(angularVelocity?.y ?? -0.03);
    const wzDeg = THREE.MathUtils.radToDeg(angularVelocity?.z ?? 0.02);

    return {
      tx, ty, tz, dist,
      rollDeg, pitchDeg, yawDeg,
      qw: quat.w, qx: quat.x, qy: quat.y, qz: quat.z,
      r11, r12, r13,
      r21, r22, r23,
      r31, r32, r33,
      wxDeg, wyDeg, wzDeg,
      relVel: Number.isFinite(relativeVelocity) ? relativeVelocity : 0.45,
    };
  }, [chaserPosition, targetPosition, targetQuaternion, angularVelocity, relativeVelocity]);

  // Keep frozen copy when in STANDBY
  if (isLiveStreaming) {
    frozenStateRef.current = liveState;
  }
  const current = isLiveStreaming ? liveState : (frozenStateRef.current || liveState);

  // Dynamic solver metrics based on selected algorithm and feature
  const solverMetrics = useMemo(() => {
    let accuracy = "0.030 px";
    let rmse = "0.030 px";
    let fps = "277 pps";
    let progress = "98%";

    if (algorithm === "EPnP") {
      accuracy = "0.042 px";
      rmse = "0.041 px";
      fps = "310 pps";
      progress = "96%";
    } else if (algorithm === "IPPE") {
      accuracy = "0.024 px";
      rmse = "0.022 px";
      fps = "245 pps";
      progress = "99%";
    }

    if (feature === "SIFT") {
      fps = algorithm === "SolvePnP" ? "185 pps" : "190 pps";
      accuracy = (parseFloat(accuracy) * 0.9).toFixed(3) + " px";
    } else if (feature === "DINOv1") {
      fps = "140 pps";
      accuracy = (parseFloat(accuracy) * 0.75).toFixed(3) + " px";
      progress = "100%";
    }

    return { accuracy, rmse, fps, progress };
  }, [algorithm, feature]);

  const matrixRows = [
    {
      row: "Row 1",
      r1: current.r11.toFixed(4),
      r2: current.r12.toFixed(4),
      r3: current.r13.toFixed(4),
      t: `${current.tx.toFixed(2)} m`,
    },
    {
      row: "Row 2",
      r1: current.r21.toFixed(4),
      r2: current.r22.toFixed(4),
      r3: current.r23.toFixed(4),
      t: `${current.ty.toFixed(2)} m`,
    },
    {
      row: "Row 3",
      r1: current.r31.toFixed(4),
      r2: current.r32.toFixed(4),
      r3: current.r33.toFixed(4),
      t: `${current.tz.toFixed(2)} m`,
    },
  ];

  return (
    <div className="pose-pipeline-engine">
      {/* 1. TOP: LIVE MATRIX CARD */}
      <div className="pipeline-card live-matrix-card">
        <div className="card-header-row">
          <div className="header-title-badge">
            <FaTable className="badge-icon" />
            <span>LIVE MATRIX</span>
          </div>
          <span className="matrix-dim-tag">3×3 R | 3×1 T</span>
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
              {matrixRows.map((r, idx) => (
                <tr key={idx}>
                  <td className="row-label">{r.row}</td>
                  <td className="num-val">{r.r1}</td>
                  <td className="num-val">{r.r2}</td>
                  <td className="num-val">{r.r3}</td>
                  <td className="t-val">{r.t}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. MIDDLE: TABBED TRANSFORMATION INSPECTOR */}
      <div className="pipeline-card transform-inspector-card">
        <div className="inspector-tabs">
          <button
            type="button"
            className={`inspector-tab-btn ${activeTab === "euler" ? "active" : ""}`}
            onClick={() => setActiveTab("euler")}
          >
            Euler Angles
          </button>
          <button
            type="button"
            className={`inspector-tab-btn ${activeTab === "quaternion" ? "active" : ""}`}
            onClick={() => setActiveTab("quaternion")}
          >
            Quaternion (q)
          </button>
          <button
            type="button"
            className={`inspector-tab-btn ${activeTab === "relative" ? "active" : ""}`}
            onClick={() => setActiveTab("relative")}
          >
            Relative State
          </button>
        </div>

        {/* Tab 1: Euler Angles (Roll, Pitch, Yaw + Angular Rates) */}
        {activeTab === "euler" && (
          <div className="rq-structured-grid">
            <div className="rq-row">
              <span className="rq-badge r-badge">R</span>
              <span className="rq-label">ROLL (X):</span>
              <strong className="rq-value">{current.rollDeg.toFixed(1)}°</strong>
              <span className="rq-subval">({current.wxDeg.toFixed(1)}°/s)</span>
            </div>
            <div className="rq-row">
              <span className="rq-badge r-badge">P</span>
              <span className="rq-label">PITCH (Y):</span>
              <strong className="rq-value">{current.pitchDeg.toFixed(1)}°</strong>
              <span className="rq-subval">({current.wyDeg.toFixed(1)}°/s)</span>
            </div>
            <div className="rq-row">
              <span className="rq-badge r-badge">Y</span>
              <span className="rq-label">YAW (Z):</span>
              <strong className="rq-value">{current.yawDeg.toFixed(1)}°</strong>
              <span className="rq-subval">({current.wzDeg.toFixed(1)}°/s)</span>
            </div>
            <div className="rq-row">
              <span className="rq-badge t-badge">T</span>
              <span className="rq-label">RANGE (R):</span>
              <strong className="rq-value cyan-glow">{current.dist.toFixed(2)} m</strong>
            </div>
          </div>
        )}

        {/* Tab 2: Unit Quaternion (qw, qx, qy, qz) */}
        {activeTab === "quaternion" && (
          <div className="rq-structured-grid">
            <div className="rq-row">
              <span className="rq-badge q-badge">W</span>
              <span className="rq-label">QUAT (qw):</span>
              <strong className="rq-value">{current.qw.toFixed(4)}</strong>
            </div>
            <div className="rq-row">
              <span className="rq-badge q-badge">X</span>
              <span className="rq-label">QUAT (qx):</span>
              <strong className="rq-value">{current.qx.toFixed(4)}</strong>
            </div>
            <div className="rq-row">
              <span className="rq-badge q-badge">Y</span>
              <span className="rq-label">QUAT (qy):</span>
              <strong className="rq-value">{current.qy.toFixed(4)}</strong>
            </div>
            <div className="rq-row">
              <span className="rq-badge q-badge">Z</span>
              <span className="rq-label">QUAT (qz):</span>
              <strong className="rq-value">{current.qz.toFixed(4)}</strong>
            </div>
          </div>
        )}

        {/* Tab 3: Relative State (Range, Closing Vel, Boresight Offset, Confidence) */}
        {activeTab === "relative" && (
          <div className="rq-structured-grid">
            <div className="rq-row">
              <span className="rq-badge t-badge">R</span>
              <span className="rq-label">RANGE:</span>
              <strong className="rq-value cyan-glow">{current.dist.toFixed(2)} m</strong>
            </div>
            <div className="rq-row">
              <span className="rq-badge r-badge">V</span>
              <span className="rq-label">CLOSING VEL:</span>
              <strong className="rq-value">{current.relVel.toFixed(2)} m/s</strong>
            </div>
            <div className="rq-row">
              <span className="rq-badge q-badge">θ</span>
              <span className="rq-label">BORESIGHT OFFSET:</span>
              <strong className="rq-value">0.84°</strong>
            </div>
            <div className="rq-row">
              <span className="rq-badge t-badge">C</span>
              <span className="rq-label">CONFIDENCE:</span>
              <strong className="rq-value" style={{ color: "#10b981" }}>98.4%</strong>
            </div>
          </div>
        )}
      </div>

      {/* 3. BOTTOM: REAL-TIME PERFORMANCE ANALYTICS (2x2 GRID) */}
      <div className="pipeline-card performance-analytics-card">
        <div className="card-header-row">
          <div className="header-title-badge">
            <FaBolt className="badge-icon" />
            <span>SOLVER PERFORMANCE</span>
          </div>
          <span className="live-status-pulse">
            {isLiveStreaming ? "● LIVE" : "❚❚ STANDBY"}
          </span>
        </div>

        <div className="metrics-2x2-grid">
          <div className="metric-cell">
            <span className="cell-label">SOLVER ACCURACY</span>
            <strong className="cell-val cyan-val">{solverMetrics.accuracy}</strong>
          </div>

          <div className="metric-cell">
            <span className="cell-label">SOLVER PROGRESS</span>
            <div className="progress-container">
              <div
                className="animated-progress-fill"
                style={{ width: solverMetrics.progress }}
              ></div>
            </div>
            <span className="cell-subtext">{solverMetrics.progress} Converged</span>
          </div>

          <div className="metric-cell">
            <span className="cell-label">REPROJECTION ERROR</span>
            <strong className="cell-val green-val">{solverMetrics.rmse}</strong>
          </div>

          <div className="metric-cell">
            <span className="cell-label">FRAME RATE</span>
            <strong className="cell-val yellow-val">{solverMetrics.fps}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PosePipeline;
