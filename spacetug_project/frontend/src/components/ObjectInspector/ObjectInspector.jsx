import React from "react";
import * as THREE from "three";
import { FaChevronRight, FaInfoCircle, FaSatellite, FaCompass, FaRocket, FaRedo } from "react-icons/fa";
import { useSimulation } from "../../context/SimulationContext";
import "./ObjectInspector.css";

function ObjectInspector({ onClose }) {
  const {
    selectedObject,
    targetPosition,
    targetQuaternion,
    angularVelocity,
    tumblingRate,
    missionConfig,
  } = useSimulation();

  // Active target satellite designation from flight plan
  const targetName =
    missionConfig?.targetModel || "Soyuz-T Satellite (Target Spacecraft)";

  // Derived live target metrics if no object was explicitly clicked
  const euler = targetQuaternion
    ? new THREE.Euler().setFromQuaternion(targetQuaternion, "XYZ")
    : new THREE.Euler(0, 0, 0);

  const distM = targetPosition
    ? Math.sqrt(
        (targetPosition.x || 0) ** 2 +
        (targetPosition.y || 0) ** 2 +
        (targetPosition.z || 0) ** 2
      ).toFixed(2)
    : "1.40";

  const displayObj = selectedObject || {
    id: "SAT-001",
    name: targetName,
    type: "Target Spacecraft",
    status: "Tracked (In Orbit)",
    distance: `${distM} m`,
    velocity: "0.45 m/s",
    position: {
      x: Number(targetPosition?.x ?? 5.2).toFixed(2),
      y: Number(targetPosition?.y ?? 0).toFixed(2),
      z: Number(targetPosition?.z ?? 1.24).toFixed(2),
    },
    attitude: {
      roll: `${((euler.x * 180) / Math.PI).toFixed(1)}°`,
      pitch: `${((euler.y * 180) / Math.PI).toFixed(1)}°`,
      yaw: `${((euler.z * 180) / Math.PI).toFixed(1)}°`,
    },
  };

  let wx = Number(angularVelocity?.x ?? displayObj?.angularVelocity?.x ?? 0);
  let wy = Number(angularVelocity?.y ?? displayObj?.angularVelocity?.y ?? 0);
  let wz = Number(angularVelocity?.z ?? displayObj?.angularVelocity?.z ?? 0);
  let tumblingRateVal = `${Math.sqrt(wx * wx + wy * wy + wz * wz).toFixed(4)} rad/s`;

  if (tumblingRate && typeof tumblingRate === "number") {
    tumblingRateVal = `${tumblingRate.toFixed(4)} rad/s`;
  }

  return (
    <div className="object-inspector">
      {/* Header with Title and Collapse Button */}
      <div className="inspector-top-bar">
        <div className="inspector-title-group">
          <FaInfoCircle className="inspector-header-icon" />
          <h2>Object Inspector</h2>
        </div>
        {onClose && (
          <button
            type="button"
            className="btn-collapse-inspector"
            onClick={onClose}
            title="Collapse Inspector Panel"
          >
            <FaChevronRight />
          </button>
        )}
      </div>

      <div className="inspector-scroll-body">
        {/* SECTION 1: OBJECT INFORMATION */}
        <section className="inspector-section">
          <h3>
            <FaSatellite className="section-icon" />
            <span>Object Information</span>
          </h3>

          <div className="inspector-row">
            <span className="row-label">Object ID</span>
            <span className="row-value highlight-cyan">{displayObj.id || "SAT-001"}</span>
          </div>

          <div className="inspector-row">
            <span className="row-label">Designation</span>
            <span className="row-value" title={displayObj.name}>{displayObj.name}</span>
          </div>

          <div className="inspector-row">
            <span className="row-label">Classification</span>
            <span className="row-value">{displayObj.type || "Target Spacecraft"}</span>
          </div>

          <div className="inspector-row">
            <span className="row-label">Operational Status</span>
            <span className="row-value status-tag">
              <span className="status-dot-pulse" />
              {displayObj.status || "Tracked"}
            </span>
          </div>
        </section>

        {/* SECTION 2: RELATIVE STATE */}
        <section className="inspector-section">
          <h3>
            <FaRocket className="section-icon" />
            <span>Relative State</span>
          </h3>

          <div className="inspector-row">
            <span className="row-label">Range / Distance</span>
            <span className="row-value highlight-green">{displayObj.distance || `${distM} m`}</span>
          </div>

          <div className="inspector-row">
            <span className="row-label">Approach Velocity</span>
            <span className="row-value">{displayObj.velocity || "0.45 m/s"}</span>
          </div>

          <div className="inspector-row-stack">
            <span className="row-label">Position Vector (X, Y, Z)</span>
            <div className="vector-pills">
              <span className="vector-pill">X: {displayObj.position?.x ?? 0}m</span>
              <span className="vector-pill">Y: {displayObj.position?.y ?? 0}m</span>
              <span className="vector-pill">Z: {displayObj.position?.z ?? 0}m</span>
            </div>
          </div>
        </section>

        {/* SECTION 3: ATTITUDE (ROLL, PITCH, YAW) */}
        <section className="inspector-section">
          <h3>
            <FaCompass className="section-icon" />
            <span>Attitude</span>
          </h3>

          <div className="inspector-row">
            <span className="row-label">Roll (X-axis)</span>
            <span className="row-value">{displayObj.attitude?.roll || `${((euler.x * 180) / Math.PI).toFixed(1)}°`}</span>
          </div>

          <div className="inspector-row">
            <span className="row-label">Pitch (Y-axis)</span>
            <span className="row-value">{displayObj.attitude?.pitch || `${((euler.y * 180) / Math.PI).toFixed(1)}°`}</span>
          </div>

          <div className="inspector-row">
            <span className="row-label">Yaw (Z-axis)</span>
            <span className="row-value">{displayObj.attitude?.yaw || `${((euler.z * 180) / Math.PI).toFixed(1)}°`}</span>
          </div>
        </section>

        {/* SECTION 4: ROTATIONAL DYNAMICS */}
        <section className="inspector-section">
          <h3>
            <FaRedo className="section-icon" />
            <span>Rotational Dynamics</span>
          </h3>

          <div className="inspector-row">
            <span className="row-label">Ang. Vel. ωX</span>
            <span className="row-value">{wx.toFixed(4)} rad/s</span>
          </div>

          <div className="inspector-row">
            <span className="row-label">Ang. Vel. ωY</span>
            <span className="row-value">{wy.toFixed(4)} rad/s</span>
          </div>

          <div className="inspector-row">
            <span className="row-label">Ang. Vel. ωZ</span>
            <span className="row-value">{wz.toFixed(4)} rad/s</span>
          </div>

          <div className="inspector-row">
            <span className="row-label">Tumbling Rate</span>
            <span className="row-value highlight-amber">{tumblingRateVal}</span>
          </div>
        </section>
      </div>
    </div>
  );
}

export default ObjectInspector;
