import "./PoseControls.css";

function PoseControls({
  algorithm = "SolvePnP",
  setAlgorithm,
  feature = "ORB",
  setFeature,
  target = "SAT-001",
  setTarget,
}) {
  return (
    <header className="pose-controls-bar">
      <div className="pose-controls-inner">
        <div className="control-item">
          <label>Algorithm</label>
          <select
            value={algorithm}
            onChange={(e) => setAlgorithm && setAlgorithm(e.target.value)}
          >
            <option value="SolvePnP">SolvePnP</option>
            <option value="EPnP">EPnP</option>
            <option value="IPPE">IPPE</option>
          </select>
        </div>

        <div className="control-item">
          <label>Feature</label>
          <select
            value={feature}
            onChange={(e) => setFeature && setFeature(e.target.value)}
          >
            <option value="ORB">ORB</option>
            <option value="SIFT">SIFT</option>
            <option value="DINOv1">DINOv1</option>
          </select>
        </div>

        <div className="control-item">
          <label>Target</label>
          <select
            value={target}
            onChange={(e) => setTarget && setTarget(e.target.value)}
          >
            <option value="SAT-001">SAT-001</option>
            <option value="SAT-002">SAT-002</option>
            <option value="Debris-001">Debris-001</option>
          </select>
        </div>

        <div className="pose-locked-badge">
          <span className="status-dot">●</span> Pose Locked
        </div>
      </div>
    </header>
  );
}

export default PoseControls;
