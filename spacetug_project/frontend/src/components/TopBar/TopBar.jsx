import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMission } from "../../context/MissionContext";
import "./TopBar.css";

function TopBar() {
  const { activeMission } = useMission();
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const utc = time.toUTCString().split(" ")[4];

  const ist = time.toLocaleTimeString("en-IN", {
    hour12: false,
    timeZone: "Asia/Kolkata",
  });

  return (
    <div className="topbar-container">
      <div className="topbar-left">
        <Link
          to="/"
          className="project-title"
          title="Return to Welcome Screen / Mission Launch"
        >
          <span className="project-icon">🛰️</span>
          <span className="project-title-text">SPACECRAFT PERCEPTION &amp; POSE ESTIMATION</span>
        </Link>
      </div>

      <div className="topbar-center">
        {activeMission ? (
          <div className="topbar-mission-chip">
            <span className="topbar-chip-label">MISSION:</span>
            <span className="topbar-chip-name">{activeMission.name || "Autonomous Flight"}</span>
            <span
              className={`topbar-chip-status ${
                activeMission.status === "RUNNING"
                  ? "status-chip-running"
                  : activeMission.status === "COMPLETED"
                  ? "status-chip-completed"
                  : "status-chip-paused"
              }`}
            >
              {activeMission.status || "RUNNING"}
            </span>
          </div>
        ) : (
          <div className="topbar-mission-chip">
            <span className="topbar-chip-label">STATUS:</span>
            <span className="topbar-chip-name">FLIGHT READY</span>
          </div>
        )}
      </div>

      <div className="time-section">
        <div className="time-item">
          <span className="time-label">UTC</span>
          <span className="time-value">{utc}</span>
        </div>
        <div className="time-divider">|</div>
        <div className="time-item">
          <span className="time-label">IST</span>
          <span className="time-value">{ist}</span>
        </div>
      </div>
    </div>
  );
}

export default TopBar;
