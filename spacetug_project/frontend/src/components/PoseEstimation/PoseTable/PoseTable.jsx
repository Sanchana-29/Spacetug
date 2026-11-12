import "./PoseTable.css";
import { useState } from "react";
import { useSensor } from "../../../context/SensorContext";
import { useSimulation } from "../../../context/SimulationContext";

function PoseTable() {
  const [activeTab, setActiveTab] = useState("matrix");
  const { poseResult } = useSensor();
  const { relativeVelocity } = useSimulation();

  const isSolved = Boolean(poseResult?.success && poseResult?.position);

  // Solved rotation matrix and translation or mathematically sound defaults
  const matrix = poseResult?.rotation_matrix || [
    [-0.2660, -0.9241, 0.2744],
    [0.9528, -0.2952, -0.0704],
    [0.1461, 0.2427, 0.9590],
  ];

  const pos = poseResult?.position || { x: 12.45, y: -3.21, z: 8.67 };
  const att = poseResult?.attitude || { roll: 14.2, pitch: -8.4, yaw: 105.6 };
  const quat = poseResult?.quaternion || { qw: 0.6558, qx: 0.1170, qy: -0.0381, qz: 0.7448 };

  const matrixData = [
    {
      row: "Row 1",
      r1: matrix[0][0]?.toFixed?.(4) ?? "-0.2660",
      r2: matrix[0][1]?.toFixed?.(4) ?? "-0.9241",
      r3: matrix[0][2]?.toFixed?.(4) ?? "0.2744",
      t: `${Number(pos.x).toFixed(2)} m`,
    },
    {
      row: "Row 2",
      r1: matrix[1][0]?.toFixed?.(4) ?? "0.9528",
      r2: matrix[1][1]?.toFixed?.(4) ?? "-0.2952",
      r3: matrix[1][2]?.toFixed?.(4) ?? "-0.0704",
      t: `${Number(pos.y).toFixed(2)} m`,
    },
    {
      row: "Row 3",
      r1: matrix[2][0]?.toFixed?.(4) ?? "0.1461",
      r2: matrix[2][1]?.toFixed?.(4) ?? "0.2427",
      r3: matrix[2][2]?.toFixed?.(4) ?? "0.9590",
      t: `${Number(pos.z).toFixed(2)} m`,
    },
  ];

  const distM = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);

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
                <td style={{ fontWeight: "bold" }}>{Number(att.roll).toFixed(4)} °</td>
              </tr>
              <tr>
                <td style={{ color: "#8ca8d8" }}>Pitch (Y)</td>
                <td style={{ fontWeight: "bold" }}>{Number(att.pitch).toFixed(4)} °</td>
              </tr>
              <tr>
                <td style={{ color: "#8ca8d8" }}>Yaw (Z)</td>
                <td style={{ fontWeight: "bold" }}>{Number(att.yaw).toFixed(4)} °</td>
              </tr>
            </tbody>
          </table>
        )}

        {activeTab === "quaternion" && (
          <table>
            <tbody>
              <tr>
                <td style={{ color: "#8ca8d8" }}>qw (scalar)</td>
                <td style={{ fontWeight: "bold" }}>{Number(quat.qw).toFixed(4)}</td>
              </tr>
              <tr>
                <td style={{ color: "#8ca8d8" }}>qx</td>
                <td style={{ fontWeight: "bold" }}>{Number(quat.qx).toFixed(4)}</td>
              </tr>
              <tr>
                <td style={{ color: "#8ca8d8" }}>qy</td>
                <td style={{ fontWeight: "bold" }}>{Number(quat.qy).toFixed(4)}</td>
              </tr>
              <tr>
                <td style={{ color: "#8ca8d8" }}>qz</td>
                <td style={{ fontWeight: "bold" }}>{Number(quat.qz).toFixed(4)}</td>
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
                  {distM.toFixed(2)} m
                </td>
              </tr>
              <tr>
                <td style={{ color: "#8ca8d8" }}>Relative Speed</td>
                <td style={{ fontWeight: "bold", color: "#4ade80" }}>
                  {Number.isFinite(relativeVelocity) ? `${relativeVelocity.toFixed(2)} m/s` : "0.00 m/s"}
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
