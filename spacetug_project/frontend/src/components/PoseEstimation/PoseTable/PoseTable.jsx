import "./PoseTable.css";
import { useState } from "react";
import { useSensor } from "../../../context/SensorContext";
import { useSimulation } from "../../../context/SimulationContext";

function PoseTable() {
  const [activeTab, setActiveTab] = useState("matrix");
  const { poseResult } = useSensor();
  const { relativeVelocity } = useSimulation();

  const isSolved = Boolean(poseResult?.success && poseResult?.position);

  // Only real solvePnP output is shown; "--" until a pose has been estimated.
  const NA = "--";
  const f4 = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(4) : NA);
  const matrix = isSolved ? poseResult.rotation_matrix : null;
  const pos = isSolved ? poseResult.position : null;
  const att = (isSolved && poseResult.attitude) || {};
  const quat = (isSolved && poseResult.quaternion) || {};

  const matrixData = [0, 1, 2].map((i) => ({
    row: `Row ${i + 1}`,
    r1: matrix ? f4(matrix[i][0]) : NA,
    r2: matrix ? f4(matrix[i][1]) : NA,
    r3: matrix ? f4(matrix[i][2]) : NA,
    t: pos ? `${Number([pos.x, pos.y, pos.z][i]).toFixed(2)} m` : NA,
  }));

  const distM = pos ? Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z) : null;

  return (
    <div className="pose-table">
      <div className="pose-tabs">
        <button
          className={activeTab === "matrix" ? "active" : ""}
          onClick={() => setActiveTab("matrix")}
        >
          Pose Matrix
        </button>

        <button
          className={activeTab === "euler" ? "active" : ""}
          onClick={() => setActiveTab("euler")}
        >
          Euler Angles
        </button>

        <button
          className={activeTab === "quaternion" ? "active" : ""}
          onClick={() => setActiveTab("quaternion")}
        >
          Quaternion
        </button>

        <button
          className={activeTab === "relative" ? "active" : ""}
          onClick={() => setActiveTab("relative")}
        >
          Relative State
        </button>
      </div>

      <div className="pose-content">
        {activeTab === "matrix" && (
          <table style={{ width: "100%", tableLayout: "auto" }}>
            <thead>
              <tr style={{ color: "#8ca8d8", borderBottom: "1px solid #26334d", textAlign: "left" }}>
                <th style={{ padding: "8px 6px", fontSize: "13px" }}>Row</th>
                <th style={{ padding: "8px 6px", fontSize: "13px" }}>R1</th>
                <th style={{ padding: "8px 6px", fontSize: "13px" }}>R2</th>
                <th style={{ padding: "8px 6px", fontSize: "13px" }}>R3</th>
                <th style={{ padding: "8px 6px", fontSize: "13px" }}>T</th>
              </tr>
            </thead>
            <tbody>
              {matrixData.map((item, idx) => (
                <tr key={idx}>
                  <td style={{ padding: "8px 6px", color: "#8ca8d8", fontWeight: "bold", fontSize: "13px", whiteSpace: "nowrap" }}>
                    {item.row}
                  </td>
                  <td style={{ padding: "8px 6px", fontSize: "13px" }}>{item.r1}</td>
                  <td style={{ padding: "8px 6px", fontSize: "13px" }}>{item.r2}</td>
                  <td style={{ padding: "8px 6px", fontSize: "13px" }}>{item.r3}</td>
                  <td style={{ padding: "8px 6px", color: "#60a5fa", fontWeight: "bold", fontSize: "13px", whiteSpace: "nowrap" }}>
                    {item.t}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {activeTab === "euler" && (
          <table>
            <tbody>
              <tr>
                <td style={{ color: "#8ca8d8" }}>Roll (X)</td>
                <td style={{ fontWeight: "bold" }}>{f4(att.roll)} °</td>
              </tr>
              <tr>
                <td style={{ color: "#8ca8d8" }}>Pitch (Y)</td>
                <td style={{ fontWeight: "bold" }}>{f4(att.pitch)} °</td>
              </tr>
              <tr>
                <td style={{ color: "#8ca8d8" }}>Yaw (Z)</td>
                <td style={{ fontWeight: "bold" }}>{f4(att.yaw)} °</td>
              </tr>
            </tbody>
          </table>
        )}

        {activeTab === "quaternion" && (
          <table>
            <tbody>
              <tr>
                <td style={{ color: "#8ca8d8" }}>qw (scalar)</td>
                <td style={{ fontWeight: "bold" }}>{f4(quat.qw)}</td>
              </tr>
              <tr>
                <td style={{ color: "#8ca8d8" }}>qx</td>
                <td style={{ fontWeight: "bold" }}>{f4(quat.qx)}</td>
              </tr>
              <tr>
                <td style={{ color: "#8ca8d8" }}>qy</td>
                <td style={{ fontWeight: "bold" }}>{f4(quat.qy)}</td>
              </tr>
              <tr>
                <td style={{ color: "#8ca8d8" }}>qz</td>
                <td style={{ fontWeight: "bold" }}>{f4(quat.qz)}</td>
              </tr>
            </tbody>
          </table>
        )}

        {activeTab === "relative" && (
          <table>
            <tbody>
              <tr>
                <td style={{ color: "#8ca8d8" }}>Relative Distance</td>
                <td style={{ fontWeight: "bold", color: "#60a5fa" }}>
                  {distM != null ? `${distM.toFixed(2)} m` : NA}
                </td>
              </tr>
              <tr>
                <td style={{ color: "#8ca8d8" }}>Relative Speed</td>
                <td style={{ fontWeight: "bold", color: "#4ade80" }}>
                  {Number.isFinite(relativeVelocity) ? `${relativeVelocity.toFixed(2)} m/s (sim)` : NA}
                </td>
              </tr>
              <tr>
                <td style={{ color: "#8ca8d8" }}>Tracking Status</td>
                <td style={{ fontWeight: "bold", color: isSolved ? "#4ade80" : "#38bdf8" }}>
                  {isSolved ? "Locked / Solved" : "Active / Synthesizing"}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default PoseTable;
