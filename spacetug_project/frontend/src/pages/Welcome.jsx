import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaSatellite,
  FaRocket,
  FaFolderOpen,
  FaTimes,
  FaPlay,
  FaFolder,
} from "react-icons/fa";
import { useMission } from "../context/MissionContext";
import { useSimulation } from "../context/SimulationContext";
import WelcomeEarthCanvas from "../components/Welcome/WelcomeEarthCanvas";
import RocketLaunchTransition from "../components/Welcome/RocketLaunchTransition";
import "./Welcome.css";

function Welcome() {
  const navigate = useNavigate();
  const { missions, loadMissionsList, startNewMission, setActiveMission } = useMission();
  const { initializeMissionSimulation, loadMissionIntoSimulation } = useSimulation();

  const [showNewMissionModal, setShowNewMissionModal] = useState(false);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchError, setLaunchError] = useState(null);

  // Flight Plan Form State - single input prompt
  const [missionName, setMissionName] = useState("");

  // Rocket Launch 3D Transition State
  const [isRocketLaunching, setIsRocketLaunching] = useState(false);
  const [launchingMissionName, setLaunchingMissionName] = useState("");

  // Ensure latest missions list is loaded on mount from spaceDB
  useEffect(() => {
    loadMissionsList();
  }, [loadMissionsList]);

  // Close modals on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setShowNewMissionModal(false);
        setShowResumeModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleOpenNewMission = () => {
    setMissionName("");
    setLaunchError(null);
    setShowNewMissionModal(true);
    setShowResumeModal(false);
  };

  const handleOpenResumeMission = () => {
    loadMissionsList();
    setLaunchError(null);
    setShowResumeModal(true);
    setShowNewMissionModal(false);
  };

  const handleLaunchMission = async (e) => {
    if (e) e.preventDefault();
    if (isLaunching) return;

    setIsLaunching(true);
    setLaunchError(null);
    const count = missions ? missions.length + 1 : 1;
    const designation = missionName.trim() || `Orbital Rendezvous Mission ${count}`;

    const missionPayload = {
      name: designation,
      chaser_model: "SpaceTug Inspector (Tri-Thruster Autonomous)",
      target_model: "Soyuz-T Satellite (Cylindrical Core + Dual Arrays)",
      orbit_regime: "LEO 450 km (ISS Co-Orbital Inclination 51.6°)",
      separation_distance: 15,
      sensor_selected: "RGB-D Camera",
      target_id: "SAT-001",
      notes: "Mission initialized from SpaceTug terminal",
    };

    try {
      // 1. Save new mission in MongoDB spaceDB
      const created = await startNewMission(missionPayload);

      // 2. Initialize simulation parameters
      initializeMissionSimulation({
        ...missionPayload,
        mission_id: created?.mission_id,
      });

      // 3. Close modal and trigger Rocket Launch Transition (loading rocket.glb)
      setShowNewMissionModal(false);
      setLaunchingMissionName(designation);
      setIsRocketLaunching(true);
    } catch (err) {
      console.error("Failed to initialize mission flight plan:", err);
      setLaunchError(err?.message || "Failed to initialize mission flight plan.");
    } finally {
      setIsLaunching(false);
    }
  };

  const handleSelectSavedMission = (mission) => {
    if (!mission) return;
    // Restore saved configuration from spaceDB and open dashboard directly WITHOUT rocket animation
    setActiveMission(mission);
    loadMissionIntoSimulation(mission, { force: true });
    setShowResumeModal(false);
    navigate("/dashboard");
  };

  const missionCount = missions ? missions.length : 0;

  return (
    <div className="welcome-page-container">
      {/* Background Starry Dust Layer */}
      <div className="welcome-star-layer" />

      {/* 3D Realistic Earth & Stars Canvas */}
      <WelcomeEarthCanvas />

      {/* Clean HUD Overlay directly over 3D Earth (No center card/box container) */}
      <main className="welcome-hero-overlay">
        {/* Top Spacecraft Icon Badge */}
        <div className="welcome-badge-circle" title="SpaceTug Orbital Perception Core">
          <FaSatellite />
        </div>

        {/* Heading */}
        <h1 className="welcome-title">
          SPACECRAFT PERCEPTION &amp; POSE ESTIMATION
        </h1>

        {/* Description */}
        <p className="welcome-description">
          Autonomous relative navigation, proximity operations, and six-degree-of-freedom pose estimation platform.
        </p>

        {/* Action Buttons */}
        <div className="welcome-actions-row">
          <button
            type="button"
            className="btn-start-mission"
            onClick={handleOpenNewMission}
          >
            <FaRocket /> START NEW MISSION
          </button>

          <button
            type="button"
            className="btn-resume-mission"
            onClick={handleOpenResumeMission}
          >
            <FaFolderOpen /> RESUME MISSION ({missionCount})
          </button>
        </div>
      </main>

      {/* =========================================================
          MODAL 1: START NEW MISSION (Simplified Single-Input Prompt)
          ========================================================= */}
      {showNewMissionModal && (
        <div
          className="mission-modal-overlay"
          onClick={() => setShowNewMissionModal(false)}
        >
          <div
            className="mission-modal-card single-input-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* Modal Header */}
            <div className="mission-modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <FaRocket style={{ color: "#38bdf8", fontSize: "18px" }} />
                <h2 className="mission-modal-title">
                  INITIALIZE NEW MISSION
                </h2>
              </div>
              <button
                type="button"
                className="mission-modal-close-btn"
                onClick={() => setShowNewMissionModal(false)}
                aria-label="Close modal"
              >
                <FaTimes />
              </button>
            </div>

            {/* Modal Form - Single Input Only */}
            <form onSubmit={handleLaunchMission}>
              <div className="mission-form-group">
                <label className="mission-form-label" htmlFor="mission-name-input">
                  MISSION DESIGNATION / NAME
                </label>
                <input
                  id="mission-name-input"
                  type="text"
                  className="mission-form-input"
                  placeholder="e.g. Orbital Rendezvous Alpha"
                  value={missionName}
                  onChange={(e) => setMissionName(e.target.value)}
                  autoFocus
                />
                <span className="mission-input-hint">
                  Specify a mission designation to register with spaceDB and initialize autonomous proximity navigation.
                </span>
              </div>

              {/* Error Message banner if launch failed */}
              {launchError && (
                <div className="mission-error-banner">
                  {launchError}
                </div>
              )}

              {/* Modal Buttons */}
              <div className="mission-modal-footer">
                <button
                  type="button"
                  className="btn-modal-cancel"
                  onClick={() => setShowNewMissionModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-modal-launch"
                  disabled={isLaunching}
                >
                  <FaRocket />
                  {isLaunching ? "Initializing..." : "Launch Mission"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================
          MODAL 2: RESUME MISSION (Saved Missions List from spaceDB)
          ========================================================= */}
      {showResumeModal && (
        <div
          className="mission-modal-overlay"
          onClick={() => setShowResumeModal(false)}
        >
          <div
            className="mission-modal-card"
            style={{ width: "660px" }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* Modal Header */}
            <div className="mission-modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <FaFolderOpen style={{ color: "#38bdf8", fontSize: "18px" }} />
                <h2 className="mission-modal-title">
                  SAVED MISSIONS IN SPACEDB ({missionCount})
                </h2>
              </div>
              <button
                type="button"
                className="mission-modal-close-btn"
                onClick={() => setShowResumeModal(false)}
                aria-label="Close modal"
              >
                <FaTimes />
              </button>
            </div>

            {/* Modal Body */}
            {missions && missions.length > 0 ? (
              <div className="saved-missions-list">
                {missions.map((m) => {
                  const statusClass =
                    m.status === "RUNNING"
                      ? "status-running"
                      : m.status === "COMPLETED"
                      ? "status-completed"
                      : "status-paused";

                  const formattedDate = m.created_at
                    ? new Date(m.created_at).toLocaleString()
                    : "Active flight plan";

                  return (
                    <div key={m.mission_id || m._id} className="saved-mission-item">
                      <div style={{ flex: 1 }}>
                        <div className="saved-mission-name">
                          {m.name || "Flight Plan"}
                        </div>

                        <div className="saved-mission-meta-row">
                          <span className="saved-mission-id">
                            {m.mission_id || "MSN"}
                          </span>
                          <span
                            className={`saved-mission-status-pill ${statusClass}`}
                          >
                            {m.status || "RUNNING"}
                          </span>
                          <span>• {formattedDate}</span>
                        </div>

                        <div className="saved-mission-details">
                          <div>
                            <span style={{ color: "#7dd3fc" }}>Chaser:</span>{" "}
                            {m.chaser_model || "SpaceTug Inspector"}
                          </div>
                          <div>
                            <span style={{ color: "#7dd3fc" }}>Target:</span>{" "}
                            {m.target_model || m.target_id || "Soyuz-T Satellite"}
                            {m.separation_distance && (
                              <span style={{ marginLeft: "10px", color: "#94a3b8" }}>
                                [Range: {m.separation_distance}m]
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div>
                        <button
                          type="button"
                          className="btn-item-resume"
                          onClick={() => handleSelectSavedMission(m)}
                        >
                          <FaPlay style={{ fontSize: "10px" }} />
                          {m.status === "CREATED" ? "START" : "RESUME"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-missions-container">
                <FaFolder className="empty-missions-icon" />
                <div className="empty-missions-title">No Saved Missions Found</div>
                <div className="empty-missions-desc">
                  Initialize a new mission flight plan with autonomous proximity navigation and 6-DoF pose tracking.
                </div>
                <button
                  type="button"
                  className="btn-modal-launch"
                  style={{ marginTop: "12px" }}
                  onClick={handleOpenNewMission}
                >
                  <FaRocket /> INITIALIZE NEW MISSION
                </button>
              </div>
            )}

            {/* Modal Footer */}
            <div className="mission-modal-footer">
              <button
                type="button"
                className="btn-modal-cancel"
                onClick={() => setShowResumeModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================
          3D ROCKET LAUNCH TRANSITION SCREEN (rocket.glb)
          ========================================================= */}
      {isRocketLaunching && (
        <RocketLaunchTransition
          missionName={launchingMissionName}
          onComplete={() => navigate("/dashboard")}
        />
      )}
    </div>
  );
}

export default Welcome;
