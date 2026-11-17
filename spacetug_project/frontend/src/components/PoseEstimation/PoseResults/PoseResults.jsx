import { useState, useMemo, useRef, useEffect } from "react";
import { FaCheckCircle } from "react-icons/fa";
import { useSensor } from "../../../context/SensorContext";
import { useSimulation } from "../../../context/SimulationContext";
import * as THREE from "three";
import "./PoseResults.css";

function formatValue(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "--";
}

/**
 * Circular Arc Translation Gauge (SVG Arc for TX/TY/TZ)
 */
function CircularArcGauge({ label, val, color, min = -10, max = 10, unit = "m" }) {
  const numVal = Number(val) || 0;
  const radius = 30;
  const circumference = 2 * Math.PI * radius;

  // Map value to 0.0 - 1.0 progress on a 260 degree arc
  const norm = Math.min(Math.max((numVal - min) / (max - min), 0), 1);
  const arcLength = circumference * 0.72;
  const strokeDashoffset = arcLength * (1 - norm);

  return (
    <div className="circular-gauge-box">
      <div className="gauge-svg-wrap">
        <svg viewBox="0 0 80 80" className="gauge-svg">
          {/* Background Track Arc */}
          <circle
            cx="40"
            cy="40"
            r={radius}
            fill="none"
            stroke="rgba(56, 189, 248, 0.15)"
            strokeWidth="5"
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeDashoffset="0"
            strokeLinecap="round"
            transform="rotate(140 40 40)"
          />
          {/* Active Colored Arc */}
          <circle
            cx="40"
            cy="40"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform="rotate(140 40 40)"
            style={{
              transition: "stroke-dashoffset 0.25s ease",
              filter: `drop-shadow(0 0 4px ${color}88)`,
            }}
          />
        </svg>
        <div className="gauge-val-inner">
          <strong className="gauge-val-text">{formatValue(numVal, 1)}</strong>
          <span className="gauge-unit-text">{unit}</span>
        </div>
      </div>
      <span className="gauge-label" style={{ color }}>{label}</span>
    </div>
  );
}

/**
 * Mini Live Sparkline Trend Chart (SVG)
 */
function MiniSparkline({ color = "#38bdf8", trend = [] }) {
  if (!trend || trend.length < 2) {
    return <div style={{ width: "60px", height: "20px" }}></div>;
  }

  const min = Math.min(...trend);
  const max = Math.max(...trend);
  const range = Math.max(max - min, 0.1);

  const points = trend
    .map((val, idx) => {
      const x = (idx / (trend.length - 1)) * 60;
      const y = 20 - ((val - min) / range) * 16;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 60 22" className="mini-sparkline-svg">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

function PoseResults({ isLiveStreaming = true }) {
  const { poseResult } = useSensor();
  const {
    chaserPosition,
    targetPosition,
    targetQuaternion,
    missionTime,
  } = useSimulation();

  // Rolling sparkline buffer of last 25 samples
  const [history, setHistory] = useState({
    roll: [0, 0],
    pitch: [0, 0],
    yaw: [0, 0],
  });

  // Show the solvePnP ESTIMATE when available; otherwise the simulation
  // ground truth (clearly labelled), never invented numbers.
  const solved = Boolean(poseResult?.success && poseResult?.position);

  const liveState = useMemo(() => {
    if (solved) {
      const p = poseResult.position;
      const a = poseResult.attitude || {};
      return {
        tx: Number(p.x), ty: Number(p.y), tz: Number(p.z),
        dist: Number(poseResult.distance_m),
        rollDeg: Number(a.roll), pitchDeg: Number(a.pitch), yawDeg: Number(a.yaw),
        rmse: Number(poseResult.reprojection_rmse_px),
        source: "ESTIMATED (solvePnP)",
      };
    }

    const tx = (targetPosition?.x ?? 0) - (chaserPosition?.x ?? 0);
    const ty = (targetPosition?.y ?? 0) - (chaserPosition?.y ?? 0);
    const tz = (targetPosition?.z ?? 0) - (chaserPosition?.z ?? 0);
    const dist = Math.sqrt(tx * tx + ty * ty + tz * tz);
    const quat = targetQuaternion ? targetQuaternion.clone() : new THREE.Quaternion();
    const euler = new THREE.Euler().setFromQuaternion(quat, "XYZ");
    return {
      tx, ty, tz, dist,
      rollDeg: THREE.MathUtils.radToDeg(euler.x),
      pitchDeg: THREE.MathUtils.radToDeg(euler.y),
      yawDeg: THREE.MathUtils.radToDeg(euler.z),
      rmse: null,
      source: "GROUND TRUTH (SIMULATION, WORLD FRAME)",
    };
  }, [solved, chaserPosition, targetPosition, targetQuaternion, poseResult]);

  // Frozen state for STANDBY mode
  const frozenStateRef = useRef(null);
  if (isLiveStreaming) {
    frozenStateRef.current = liveState;
  }
  const current = isLiveStreaming ? liveState : (frozenStateRef.current || liveState);

  // Update rolling history buffer at 10 Hz when live streaming
  useEffect(() => {
    if (!isLiveStreaming) return;

    setHistory((prev) => {
      const maxSamples = 25;
      const nextRoll = [...prev.roll, current.rollDeg].slice(-maxSamples);
      const nextPitch = [...prev.pitch, current.pitchDeg].slice(-maxSamples);
      const nextYaw = [...prev.yaw, current.yawDeg].slice(-maxSamples);
      return { roll: nextRoll, pitch: nextPitch, yaw: nextYaw };
    });
  }, [missionTime, isLiveStreaming, current.rollDeg, current.pitchDeg, current.yawDeg]);

  return (
    <div className="pose-results-container">
      {/* ======================================================== */}
      {/* 1. RELATIVE POSITION VECTOR (T) & CIRCULAR GAUGES */}
      {/* ======================================================== */}
      <div className="results-card position-gauges-card">
        <div className="card-header-bar">
          <span className="header-badge-tag">POSITION · {current.source}</span>
          <span className="header-range-pill">R = {formatValue(current.dist, 2)} m</span>
        </div>

        <div className="gauges-flex-row">
          <CircularArcGauge label="TX" val={current.tx} color="#ef4444" min={-10} max={10} />
          <CircularArcGauge label="TY" val={current.ty} color="#22c55e" min={-10} max={10} />
          <CircularArcGauge label="TZ" val={current.tz} color="#38bdf8" min={-10} max={10} />
        </div>
      </div>

      {/* ======================================================== */}
      {/* 2. ATTITUDE ORIENTATION (EULER) STACKED CARDS */}
      {/* ======================================================== */}
      <div className="results-card attitude-stack-card">
        <div className="card-header-bar">
          <span className="header-badge-tag">ATTITUDE ORIENTATION (EULER)</span>
          <span className="header-subtag">{solved ? "CAMERA FRAME" : "WORLD FRAME"}</span>
        </div>

        <div className="attitude-cards-list">
          {/* ROLL (X) */}
          <div className="attitude-item-card roll-card">
            <div className="item-left-metric">
              <span className="axis-title" style={{ color: "#ef4444" }}>ROLL (X)</span>
              <strong className="axis-degrees-val">{formatValue(current.rollDeg, 1)}°</strong>
            </div>

            <div className="item-right-sparkline">
              <div className="sparkline-row">
                <MiniSparkline color="#ef4444" trend={history.roll} />
                <span className="pose-locked-tag">
                  <FaCheckCircle className="lock-icon" /> {solved ? "Estimated" : "Sim truth"}
                </span>
              </div>
              <div className="axis-progress-bar">
                <div
                  className="progress-fill roll-fill"
                  style={{ width: `${Math.min(Math.max((current.rollDeg + 180) / 3.6, 5), 100)}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* PITCH (Y) */}
          <div className="attitude-item-card pitch-card">
            <div className="item-left-metric">
              <span className="axis-title" style={{ color: "#22c55e" }}>PITCH (Y)</span>
              <strong className="axis-degrees-val">{formatValue(current.pitchDeg, 1)}°</strong>
            </div>

            <div className="item-right-sparkline">
              <div className="sparkline-row">
                <MiniSparkline color="#22c55e" trend={history.pitch} />
                <span className="pose-locked-tag">
                  <FaCheckCircle className="lock-icon" /> {solved ? "Estimated" : "Sim truth"}
                </span>
              </div>
              <div className="axis-progress-bar">
                <div
                  className="progress-fill pitch-fill"
                  style={{ width: `${Math.min(Math.max((current.pitchDeg + 180) / 3.6, 5), 100)}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* YAW (Z) */}
          <div className="attitude-item-card yaw-card">
            <div className="item-left-metric">
              <span className="axis-title" style={{ color: "#38bdf8" }}>YAW (Z)</span>
              <strong className="axis-degrees-val">{formatValue(current.yawDeg, 1)}°</strong>
            </div>

            <div className="item-right-sparkline">
              <div className="sparkline-row">
                <MiniSparkline color="#38bdf8" trend={history.yaw} />
                <span className="pose-locked-tag">
                  <FaCheckCircle className="lock-icon" /> {solved ? "Estimated" : "Sim truth"}
                </span>
              </div>
              <div className="axis-progress-bar">
                <div
                  className="progress-fill yaw-fill"
                  style={{ width: `${Math.min(Math.max((current.yawDeg + 180) / 3.6, 5), 100)}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 3. SOLVER ACCURACY & RMSE CARD (BOTTOM) */}
      {/* ======================================================== */}
      <div className="results-card solver-rmse-card">
        <div className="rmse-inner-row">
          <div className="rmse-left-group">
            <span className="rmse-label">Reprojection Error (RMSE):</span>
            <strong className="rmse-numeric-val">{current.rmse != null ? `${current.rmse.toFixed(3)} px` : "-- (no estimate)"}</strong>
          </div>
          <div className="precision-pill-badge">
            {current.rmse == null
              ? "NO ESTIMATE"
              : current.rmse < 1
              ? "SUB-PIXEL"
              : current.rmse < 3
              ? "GOOD FIT"
              : "HIGH ERROR"}
          </div>
        </div>
      </div>
    </div>
  );
}

export default PoseResults;
