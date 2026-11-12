import "./SensorTabs.css";
import { useSensor } from "../../../context/SensorContext";
import { useSimulation } from "../../../context/SimulationContext";
import { SensorCanvas } from "../SensorViewer/SensorTargetView";

/**
 * Live 3D Mini Sensor Preview Box Component
 * Renders lightweight, synchronized chaser-mounted sensor views for all 4 modalities.
 */
function MiniSensorPreview({ sensor, isSelected }) {
  if (sensor === "Stereo Camera") {
    return (
      <div className={`mini-sensor-preview mini-stereo-preview ${isSelected ? "active" : ""}`}>
        <div className="mini-stereo-half">
          <SensorCanvas
            sensor="Stereo Camera"
            subType="Stereo Left"
            canvasId="mini-canvas-stereo-left"
            isMini={true}
          />
          <span className="mini-stereo-tag">LEFT</span>
        </div>

        <div className="mini-stereo-divider" />

        <div className="mini-stereo-half">
          <SensorCanvas
            sensor="Stereo Camera"
            subType="Stereo Right"
            canvasId="mini-canvas-stereo-right"
            isMini={true}
          />
          <span className="mini-stereo-tag" style={{ left: "auto", right: "4px" }}>RIGHT</span>
        </div>
      </div>
    );
  }

  const specLabels = {
    "RGB-D Camera": { tag: "RGB-D OPTICAL", color: "#38bdf8" },
    "Thermal Camera": { tag: "SWIR / THERMAL", color: "#e2e8f0" },
    LiDAR: { tag: "3D POINT CLOUD", color: "#4ade80" },
  };

  const info = specLabels[sensor] || { tag: "SENSOR POV", color: "#38bdf8" };

  return (
    <div className={`mini-sensor-preview ${isSelected ? "active" : ""}`}>
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <SensorCanvas
          sensor={sensor}
          canvasId={`mini-canvas-${sensor.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
          isMini={true}
        />
        <span
          className="mini-img-tag"
          style={{ borderColor: info.color, color: info.color }}
        >
          {info.tag}
        </span>
      </div>
    </div>
  );
}

/**
 * Vertical Sensor Dock Component
 * Stacked vertical sidebar on the left holding mini-views for:
 * 1. RGB-D Camera
 * 2. Stereo Camera
 * 3. Thermal IR Camera
 * 4. LiDAR
 * Clicking any card instantly swaps its feed into the primary viewport.
 */
function SensorTabs({ sensorData }) {
  const { selectedSensor, setSelectedSensor } = useSensor();
  const { addMissionEvent } = useSimulation();

  const handleSensorSelect = (sensorName) => {
    if (sensorName !== selectedSensor) {
      setSelectedSensor(sensorName);
      addMissionEvent(`Sensor switched to ${sensorName}`, "INFO");
    }
  };

  const sensors = [
    {
      name: "RGB-D Camera",
      key: "rgbd",
      badge: "RGB+DEPTH",
    },
    {
      name: "Stereo Camera",
      key: "stereo",
      badge: "BINOCULAR",
    },
    {
      name: "Thermal Camera",
      key: "thermal",
      badge: "SWIR RADIANCE",
    },
    {
      name: "LiDAR",
      key: "lidar",
      badge: "LASER CLOUD",
    },
  ];

  return (
    <aside className="sensor-dock-sidebar">
      <div className="sensor-dock-title">
        <span>SENSOR PAYLOADS</span>
        <span className="sensor-dock-count">4 ACTIVE</span>
      </div>

      <div className="sensor-dock-cards">
        {sensors.map((sensor) => {
          const isSelected = selectedSensor === sensor.name;
          const data = sensorData?.[sensor.key];

          return (
            <button
              key={sensor.name}
              type="button"
              className={`sensor-card ${isSelected ? "selected" : ""}`}
              onClick={() => handleSensorSelect(sensor.name)}
              title={`Click to switch primary viewport to ${sensor.name}`}
            >
              {/* CARD HEADER */}
              <div className="sensor-card-header">
                <div className="sensor-name-group">
                  <h3>{sensor.name}</h3>
                  <span className="sensor-badge">{sensor.badge}</span>
                </div>

                <span className="sensor-status">
                  <span className="status-dot" />
                  {data?.status ? data.status.toUpperCase() : "LIVE"}
                </span>
              </div>

              {/* 3D MINI SENSOR PREVIEW */}
              <MiniSensorPreview sensor={sensor.name} isSelected={isSelected} />

              {/* ACTIVE SELECTION INDICATOR */}
              {isSelected && (
                <div className="sensor-card-active-pill">
                  PRIMARY VIEWPORT FEED
                </div>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

export default SensorTabs;
