import { Suspense, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF, Html, Stars } from "@react-three/drei";
import { FaSatellite } from "react-icons/fa";
import { TARGET_LANDMARKS_3D, LANDMARK_SCALE } from "../../../utils/poseGeometry";
import { useMission } from "../../../context/MissionContext";
import "./SatelliteModel.css";

/** Parts of SAT-001, each with the pose landmarks that lie on it (real mesh vertices of satellite.glb). */
const PARTS = [
  {
    id: "solar_right",
    name: "Solar array – right wing",
    color: "#38bdf8",
    landmarks: ["solar_panel_right_tip_upper", "solar_panel_right_tip_lower"],
    role: "Deployable photovoltaic wing that powers the satellite.",
    vision: "Outer corners are sharp, high-contrast points: ideal 2D–3D landmarks for solvePnP.",
  },
  {
    id: "solar_left",
    name: "Solar array – left wing",
    color: "#0ea5e9",
    landmarks: ["solar_panel_left_tip_upper", "solar_panel_left_tip_lower"],
    role: "Second power wing, mounted opposite the right wing.",
    vision: "Its long edges give strong line features; tips widen the landmark baseline (better pose accuracy).",
  },
  {
    id: "antenna",
    name: "High-gain antenna dish",
    color: "#facc15",
    landmarks: ["antenna_dish_top", "primary_dish_center"],
    role: "Parabolic dish for communication with ground stations / relay satellites.",
    vision: "Circular rim and centre are easy to detect from many viewpoints (ORB/SIFT keypoints).",
  },
  {
    id: "lens",
    name: "Optical sensor (lens)",
    color: "#a78bfa",
    landmarks: ["optical_lens_center"],
    role: "Payload camera / sensor aperture.",
    vision: "Dark circular feature that is distinctive against the bright bus.",
  },
  {
    id: "bus",
    name: "Main bus (body)",
    color: "#f97316",
    landmarks: ["chassis_rear_base", "chassis_side_panel"],
    role: "Central structure: avionics, batteries, propulsion and the capture/docking interface.",
    vision: "Rigid body that defines the target frame; the servicer aims its capture tool here.",
  },
];

const PRETTY = (id) => id.replace(/_/g, " ");

// centre of the model (glTF units), so it rotates around its middle
const MODEL_CENTER = [1.35, -0.255, -2.14];

function SatelliteMesh({ selected, onPick }) {
  const { scene } = useGLTF("/models/satellite.glb");
  const model = useMemo(() => scene.clone(true), [scene]);
  const activePart = PARTS.find((p) => p.id === selected);

  return (
    <group scale={LANDMARK_SCALE} position={MODEL_CENTER.map((c) => -c * LANDMARK_SCALE)}>
      <primitive object={model} />
      {PARTS.flatMap((part) =>
        part.landmarks.map((lid) => {
          const pos = TARGET_LANDMARKS_3D[lid];
          if (!pos) return null;
          const on = !activePart || activePart.id === part.id;
          return (
            <Html key={lid} position={pos} center zIndexRange={[20, 0]}>
              <button
                type="button"
                className={`sm-pin ${activePart?.id === part.id ? "active" : ""}`}
                style={{ "--pin": part.color, opacity: on ? 1 : 0.25 }}
                onClick={() => onPick(part.id)}
                title={`${part.name}: ${PRETTY(lid)}`}
              >
                <span className="sm-dot" />
                {activePart?.id === part.id && <span className="sm-label">{PRETTY(lid)}</span>}
              </button>
            </Html>
          );
        })
      )}
    </group>
  );
}

function SatelliteModel() {
  const [selected, setSelected] = useState("solar_right");
  const [autoRotate, setAutoRotate] = useState(true);
  const { activeMission } = useMission() || {};
  const part = PARTS.find((p) => p.id === selected);

  const facts = [
    ["Target ID", "SAT-001"],
    ["Type", activeMission?.target_model || "Satellite with dual solar arrays"],
    ["Model file", "satellite.glb (30 meshes, 15,182 triangles)"],
    ["Size in simulation", "1.05 m × 0.29 m × 0.68 m (scale 0.08)"],
    ["Pose landmarks", `${Object.keys(TARGET_LANDMARKS_3D).length} mesh vertices (solvePnP)`],
    ["Simulated tumble", "ω = (0.05, −0.03, 0.02) rad/s ≈ 3.53 °/s"],
    ["Detector class", "satellite (YOLOv8n)"],
  ];

  return (
    <div className="sm-wrap">
      <div className="sm-viewer">
        <Canvas camera={{ position: [0.62, 0.38, 1.05], fov: 45 }} dpr={[1, 2]}>
          <color attach="background" args={["#060b14"]} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[3, 4, 5]} intensity={2.2} />
          <directionalLight position={[-4, -2, -3]} intensity={0.5} />
          <Stars radius={60} depth={30} count={1500} factor={3} fade />
          <Suspense fallback={null}>
            <SatelliteMesh selected={selected} onPick={setSelected} />
          </Suspense>
          <OrbitControls enableDamping autoRotate={autoRotate} autoRotateSpeed={0.8} minDistance={0.6} maxDistance={5} />
        </Canvas>
        <div className="sm-viewer-bar">
          <span>Drag to rotate · scroll to zoom · click a dot</span>
          <label>
            <input type="checkbox" checked={autoRotate} onChange={(e) => setAutoRotate(e.target.checked)} /> Auto-rotate
          </label>
        </div>
      </div>

      <aside className="sm-side">
        <h3>
          <FaSatellite /> Target satellite – parts
        </h3>
        <div className="sm-parts">
          {PARTS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`sm-part ${selected === p.id ? "active" : ""}`}
              style={{ "--pin": p.color }}
              onClick={() => setSelected(p.id)}
            >
              <span className="sm-swatch" />
              {p.name}
              <span className="sm-count">{p.landmarks.length}</span>
            </button>
          ))}
        </div>

        {part && (
          <div className="sm-detail" style={{ "--pin": part.color }}>
            <h4>{part.name}</h4>
            <p>
              <b>Function:</b> {part.role}
            </p>
            <p>
              <b>Why it matters for vision:</b> {part.vision}
            </p>
            <p className="sm-lms">
              <b>Landmarks:</b> {part.landmarks.map(PRETTY).join(", ")}
            </p>
          </div>
        )}

        <table className="sm-facts">
          <tbody>
            {facts.map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </aside>
    </div>
  );
}

useGLTF.preload("/models/satellite.glb");

export default SatelliteModel;
