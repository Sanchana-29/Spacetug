import React, { useState } from "react";
import { FaSatellite, FaChevronRight, FaChevronLeft, FaPlus, FaSearch } from "react-icons/fa";
import { useSimulation } from "../../context/SimulationContext";
import "./SatelliteSelector.css";

export default function SatelliteSelector() {
  const [collapsed, setCollapsed] = useState(false);
  const {
    selectedObject,
    setSelectedObject,
    targetPosition,
    missionConfig,
  } = useSimulation();

  const satelliteModelName =
    missionConfig?.targetModel || "Soyuz-T Satellite (Cylindrical Core + Dual Arrays)";

  const handleSelectSatellite = () => {
    setSelectedObject({
      id: "SAT-001",
      name: satelliteModelName,
      type: "Target Spacecraft",
      status: "Active (In Orbit)",
      distance: "15.0 m",
      velocity: "0.45 m/s",
      position: {
        x: Number(targetPosition?.x ?? 5.2).toFixed(2),
        y: Number(targetPosition?.y ?? 0).toFixed(2),
        z: Number(targetPosition?.z ?? 1.24).toFixed(2),
      },
      attitude: {
        roll: "0.0°",
        pitch: "0.0°",
        yaw: "90.0°",
      },
      trackingStatus: "Locked",
      confidence: "99.4%",
    });
  };

  const isSelected = selectedObject?.id === "SAT-001";

  return (
    <div className={`satellite-selector-drawer ${collapsed ? "collapsed" : ""}`}>
      {/* Toggle button */}
      <button
        type="button"
        className="satellite-drawer-toggle"
        onClick={() => setCollapsed(!collapsed)}
        title={collapsed ? "Open Satellite Selector" : "Collapse Drawer"}
      >
        {collapsed ? <FaChevronLeft /> : <FaChevronRight />}
        {collapsed && <span className="toggle-vertical-label">SATELLITES</span>}
      </button>

      {!collapsed && (
        <div className="satellite-drawer-content">
          <div className="satellite-drawer-header">
            <div className="header-title-box">
              <FaSatellite className="satellite-header-icon" />
              <span>SATELLITE SELECTION</span>
            </div>
            <span className="satellite-count-badge">1 MODEL</span>
          </div>

          <div className="satellite-drawer-body">
            <div
              className={`satellite-card-item ${isSelected ? "selected" : ""}`}
              onClick={handleSelectSatellite}
            >
              <div className="satellite-thumb-container">
                <img
                  src="/models/satellite_thumb.png"
                  alt="Satellite 3D Model"
                  className="satellite-thumb-img"
                  onError={(e) => {
                    // Fallback to icon if thumbnail image not found
                    e.target.style.display = "none";
                    e.target.nextSibling.style.display = "flex";
                  }}
                />
                <div className="satellite-fallback-icon" style={{ display: "none" }}>
                  <FaSatellite size={28} />
                </div>
                <div className="satellite-format-badge">.GLB</div>
              </div>

              <div className="satellite-card-meta">
                <div className="satellite-card-title" title={satelliteModelName}>
                  {satelliteModelName}
                </div>
                <div className="satellite-card-subtitle">
                  ID: SAT-001 • Cylindrical Core + Solar Arrays
                </div>
                <div className="satellite-card-status">
                  <span className="status-dot-active" />
                  <span>Placed in Simulation Scene</span>
                </div>
              </div>

              <div className="satellite-card-actions">
                <button
                  type="button"
                  className="btn-inspect-sat"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectSatellite();
                  }}
                  title="Inspect this satellite in Object Inspector"
                >
                  <FaSearch /> {isSelected ? "Selected" : "Inspect"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

