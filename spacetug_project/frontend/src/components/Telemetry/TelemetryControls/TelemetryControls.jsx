
import { useSimulation } from "../../../context/SimulationContext";
import "./TelemetryControls.css";

function TelemetryControls() {
  const {
    missionTime,
    isRunning,
    isRecording,
    setIsRecording,
    telemetryUpdateRate,
    setTelemetryUpdateRate,
  } = useSimulation();

  const formatTime = (seconds = 0) => {
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    return [hours, minutes, secs]
      .map((value) => String(value).padStart(2, "0"))
      .join(":");
  };

  return (
    <div className="telemetry-controls">
      <div className="control-group">
        <label>Mission Time</label>
        <div className="control-value">{formatTime(missionTime)}</div>
      </div>

      <div className="control-group">
        <label>Update Rate</label>
        <select
          value={String(telemetryUpdateRate)}
          onChange={(event) =>
            setTelemetryUpdateRate(Number(event.target.value))
          }
        >
          <option value="10">10 Hz</option>
          <option value="20">20 Hz</option>
          <option value="30">30 Hz</option>
        </select>
      </div>

      <div className="control-group">
        <label>Recording</label>
        <button
          type="button"
          aria-pressed={isRecording}
          className={`status recording-status ${
            isRecording ? "active" : "inactive"
          }`}
          onClick={() => setIsRecording((previous) => !previous)}
        >
          ● {isRecording ? "REC ON" : "OFF"}
        </button>
      </div>

      <div className="control-group">
        <label>Telemetry Status</label>
        <div className={`status ${isRunning ? "active" : "inactive"}`}>
          ● {isRunning ? "RUNNING" : "PAUSED"}
        </div>
      </div>
    </div>
  );
}

export default TelemetryControls;
    