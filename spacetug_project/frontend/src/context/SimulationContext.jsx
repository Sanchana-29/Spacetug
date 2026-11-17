import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
} from "react";
import * as THREE from "three";
import {
  ORBIT_RADIUS,
  CHASER_ORBIT_X,
  CHASER_ORBIT_Z,
  TARGET_ORBIT_X,
  TARGET_ORBIT_Z,
  INITIAL_CHASER_POSITION,
  INITIAL_TARGET_POSITION,
  getChaserPositionAtTime,
  getTargetPositionAtTime,
} from "../utils/trajectory";

const SimulationContext = createContext();

// Maximum rolling buffer of 60 seconds at 10 Hz = 600 samples
const MAX_TELEMETRY_SAMPLES = 600;

const INITIAL_TARGET_QUATERNION = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(0, Math.PI / 2, 0)
);

function getRelativePosition(chaserPosition, targetPosition) {
  return {
    x: targetPosition.x - chaserPosition.x,
    y: targetPosition.y - chaserPosition.y,
    z: targetPosition.z - chaserPosition.z,
  };
}

function getDistance(position) {
  return Math.sqrt(
    position.x * position.x +
    position.y * position.y +
    position.z * position.z
  );
}

function SimulationProvider({ children }) {
  const [selectedObject, setSelectedObject] = useState(null);
  const [trackingTarget, setTrackingTarget] = useState(null);
  const [isTracking, setIsTracking] = useState(false);
  const [isPoseLocked, setIsPoseLocked] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState("CHASER"); // "CHASER" | "TARGET" | "FREE"

  const [isRunning, setIsRunning] = useState(false);
  const [simulationSpeed, setSimulationSpeed] = useState(1);

  const [missionTime, setMissionTime] = useState(0);
  const simTimeRef = useRef(0);

  const [resetKey, setResetKey] = useState(0);

  // High-performance physics refs (directly mutated at 60 FPS without React re-renders)
  const chaserPosRef = useRef(new THREE.Vector3(INITIAL_CHASER_POSITION.x, INITIAL_CHASER_POSITION.y, INITIAL_CHASER_POSITION.z));
  const targetPosRef = useRef(new THREE.Vector3(INITIAL_TARGET_POSITION.x, INITIAL_TARGET_POSITION.y, INITIAL_TARGET_POSITION.z));
  const targetQuatRef = useRef(INITIAL_TARGET_QUATERNION.clone());
  const angVelRef = useRef({ x: 0, y: 0, z: 0 });
  const tumblingRateRef = useRef(0);
  const simSpeedRef = useRef(1);

  useEffect(() => {
    simSpeedRef.current = simulationSpeed;
  }, [simulationSpeed]);

  // Mission event history (up to 200 events per requirements)
  const [missionEvents, setMissionEvents] = useState([]);
  const eventIdRef = useRef(0);
  const previousStateRef = useRef(null);
  const hasStartedRef = useRef(false);

  // Hysteresis alert state tracking
  const alertStateRef = useRef({
    tumblingHigh: false,
    rangeLow: false,
    trackingInactive: false,
  });

  // Recording toggle state
  const [isRecording, setIsRecording] = useState(false);

  // Active mission flight plan configuration
  const [missionConfig, setMissionConfig] = useState(() => {
    try {
      const saved = sessionStorage.getItem("spacecraft_active_mission");
      if (saved) {
        const m = JSON.parse(saved);
        return {
          chaserModel: m.chaser_model || "SpaceTug Inspector (Tri-Thruster Autonomous)",
          targetModel: m.target_model || "Soyuz-T Satellite (Cylindrical Core + Dual Arrays)",
          orbitRegime: m.orbit_regime || "LEO 450 km (ISS Co-Orbital Inclination 51.6°)",
          separationDistance: Number(m.separation_distance || 15),
        };
      }
    } catch { }
    return {
      chaserModel: "SpaceTug Inspector (Tri-Thruster Autonomous)",
      targetModel: "Soyuz-T Satellite (Cylindrical Core + Dual Arrays)",
      orbitRegime: "LEO 450 km (ISS Co-Orbital Inclination 51.6°)",
      separationDistance: 15,
    };
  });

  // Active IR Floodlight toggle state (illuminates shadowed targets during eclipse)
  const [irFloodlight, setIrFloodlight] = useState(false);

  // Shared telemetry history and selectable sampling frequency.
  const [telemetrySamples, setTelemetrySamples] = useState([]);
  const [telemetryUpdateRate, setTelemetryUpdateRate] = useState(10);
  const lastTelemetrySampleTimeRef = useRef(null);
  const previousRelativePositionRef = useRef(null);

  const addMissionEvent = useCallback(
    (message, type = "INFO", time = simTimeRef.current, meta = {}) => {
      const event = {
        id: ++eventIdRef.current,
        time: Math.max(0, time),
        message,
        type,
        timestamp: new Date().toLocaleTimeString(),
        ...meta,
      };

      setMissionEvents((previous) =>
        [event, ...previous].slice(0, 200)
      );

      // Asynchronously persist to spaceDB mission_logs
      import("../services/api").then(({ createMissionLog }) => {
        try {
          const missionId = sessionStorage.getItem("spacecraft_active_mission")
            ? JSON.parse(sessionStorage.getItem("spacecraft_active_mission"))?.mission_id
            : "MSN-DEFAULT-01";

          createMissionLog({
            mission_id: missionId || "MSN-DEFAULT-01",
            event_type: type,
            message: message,
            target_id: meta.target_id || "SAT-001",
            sensor_id: meta.sensor_id || null,
            time_s: Math.max(0, time),
          }).catch(() => null);
        } catch (e) { }
      });
    },
    []
  );

  // Throttled UI telemetry states (Position, Velocity, Range) updated at max 10 FPS (100ms)
  const [chaserPosition, setChaserPosition] = useState({
    ...INITIAL_CHASER_POSITION,
  });

  const [targetPosition, setTargetPosition] = useState({
    ...INITIAL_TARGET_POSITION,
  });

  const [targetQuaternion, setTargetQuaternion] = useState(
    INITIAL_TARGET_QUATERNION.clone()
  );

  const [angularVelocity, setAngularVelocity] = useState({
    x: 0,
    y: 0,
    z: 0,
  });
  const [tumblingRate, setTumblingRate] = useState(0);

  /*
   * Mission event tracking.
   */
  useEffect(() => {
    const currentState = {
      isRunning,
      isTracking,
      isRecording,
    };

    const previous = previousStateRef.current;

    if (previous === null) {
      previousStateRef.current = currentState;
      return;
    }

    if (previous.isRunning !== isRunning) {
      if (isRunning) {
        addMissionEvent(
          hasStartedRef.current
            ? "Simulation resumed"
            : "Simulation started",
          "SUCCESS"
        );
        hasStartedRef.current = true;
      } else if (hasStartedRef.current) {
        addMissionEvent("Simulation paused", "WARNING");
      }
    }

    if (previous.isTracking !== isTracking) {
      if (isTracking) {
        addMissionEvent("Tracking started: Target locked", "SUCCESS");
      } else {
        addMissionEvent("Tracking inactive", "WARNING");
      }
    }

    if (previous.isRecording !== isRecording) {
      addMissionEvent(
        isRecording
          ? "Telemetry recording enabled"
          : "Telemetry recording disabled",
        isRecording ? "SUCCESS" : "INFO"
      );
    }

    previousStateRef.current = currentState;
  }, [isRunning, isTracking, isRecording, addMissionEvent]);

  /*
   * DECOUPLED PHYSICS LOOP WITH REF-BASED FRAME DELTA SCALING
   * Updates THREE.js positions/rotations at pure 60 FPS in refs.
   * Throttles React state dispatches to max 10 FPS (100ms).
   */
  useEffect(() => {
    if (!isRunning) return undefined;

    let animId;
    let lastTime = performance.now();
    let lastUiDispatchTime = 0;

    const tick = (now) => {
      const deltaSec = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      // Ref-based Frame Delta Scaling with time-warp multiplier (deltaSec * simSpeed)
      const currentSpeed = simSpeedRef.current;
      const simDt = deltaSec * currentSpeed;
      simTimeRef.current += simDt;
      const t = simTimeRef.current;

      // 1. Mutate physical Vector3 refs directly (continuous 60 FPS physics without re-renders)
      const nextChaserVec = getChaserPositionAtTime(t);
      chaserPosRef.current.copy(nextChaserVec);

      const nextTargetVec = getTargetPositionAtTime(t);
      targetPosRef.current.copy(nextTargetVec);

      // 2. Physical angular tumbling dynamics
      if (simDt > 0) {
        const baseTumble = { x: 0.05, y: -0.03, z: 0.02 };
        const deltaQuat = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            baseTumble.x * simDt,
            baseTumble.y * simDt,
            baseTumble.z * simDt,
            "XYZ"
          )
        );

        const currentQuat = targetQuatRef.current;
        const nextQuat = currentQuat.clone().multiply(deltaQuat);

        const diffQuat = nextQuat.clone().multiply(currentQuat.clone().invert());
        if (diffQuat.w < 0) {
          diffQuat.x = -diffQuat.x;
          diffQuat.y = -diffQuat.y;
          diffQuat.z = -diffQuat.z;
          diffQuat.w = -diffQuat.w;
        }

        const angle = 2 * Math.acos(Math.max(-1, Math.min(1, diffQuat.w)));
        let wX = 0, wY = 0, wZ = 0;
        if (angle > 0.0001) {
          const sin = Math.sqrt(Math.max(0, 1 - diffQuat.w * diffQuat.w));
          if (sin > 0.0001) {
            wX = (diffQuat.x / sin) * (angle / simDt);
            wY = (diffQuat.y / sin) * (angle / simDt);
            wZ = (diffQuat.z / sin) * (angle / simDt);
          }
        }

        targetQuatRef.current.copy(nextQuat);
        angVelRef.current = { x: wX, y: wY, z: wZ };
        tumblingRateRef.current = Math.sqrt(wX * wX + wY * wY + wZ * wZ);
      }

      // 3. THROTTLED TELEMETRY DISPATCH (10 FPS / 100ms interval) to completely prevent React lag
      if (now - lastUiDispatchTime >= 100) {
        lastUiDispatchTime = now;

        setMissionTime(t);
        setChaserPosition({
          x: nextChaserVec.x,
          y: nextChaserVec.y,
          z: nextChaserVec.z,
        });
        setTargetPosition({
          x: nextTargetVec.x,
          y: nextTargetVec.y,
          z: nextTargetVec.z,
        });
        setTargetQuaternion(targetQuatRef.current.clone());
        setAngularVelocity(angVelRef.current);
        setTumblingRate(tumblingRateRef.current);
      }

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(animId);
  }, [isRunning]);

  /*
   * TELEMETRY SAMPLING
   * Samples the latest simulation state at the selected rate.
   */
  useEffect(() => {
    if (resetKey > 0 && missionTime === 0) return;
    if (!isRunning) return;

    const interval = 1 / telemetryUpdateRate;
    const lastTime = lastTelemetrySampleTimeRef.current;

    if (lastTime !== null && missionTime - lastTime < interval) {
      return;
    }

    const relativePosition = getRelativePosition(
      chaserPosition,
      targetPosition
    );

    const distance = getDistance(relativePosition);

    let relativeVelocity = null;
    const previousPosition = previousRelativePositionRef.current;

    if (previousPosition && lastTime !== null) {
      const dt = missionTime - lastTime;

      if (dt > 0) {
        const vx = (relativePosition.x - previousPosition.x) / dt;
        const vy = (relativePosition.y - previousPosition.y) / dt;
        const vz = (relativePosition.z - previousPosition.z) / dt;

        relativeVelocity = Math.sqrt(vx * vx + vy * vy + vz * vz);
      }
    }

    const euler = new THREE.Euler().setFromQuaternion(
      targetQuaternion,
      "XYZ"
    );

    const sample = {
      time: Number(missionTime.toFixed(3)),
      distance,
      velocity: relativeVelocity,
      roll: THREE.MathUtils.radToDeg(euler.x),
      pitch: THREE.MathUtils.radToDeg(euler.y),
      yaw: THREE.MathUtils.radToDeg(euler.z),
      tumblingRate: tumblingRateRef.current,
    };

    // --- Dynamic Condition Monitoring with Hysteresis ---
    // 1. Tumbling rate: warn at >= 0.05 rad/s, clear below 0.045 rad/s
    const currentTumble = tumblingRateRef.current;
    if (!alertStateRef.current.tumblingHigh && currentTumble >= 0.05) {
      alertStateRef.current.tumblingHigh = true;
      addMissionEvent(`Tumbling rate exceeds 0.05 rad/s (${currentTumble.toFixed(3)} rad/s)`, "WARNING");
    } else if (alertStateRef.current.tumblingHigh && currentTumble < 0.045) {
      alertStateRef.current.tumblingHigh = false;
      addMissionEvent(`Tumbling rate nominal recovered (${currentTumble.toFixed(3)} rad/s)`, "SUCCESS");
    }

    // 2. Safe distance: warn below 2.0m, clear above 2.2m
    if (!alertStateRef.current.rangeLow && distance < 2.0) {
      alertStateRef.current.rangeLow = true;
      addMissionEvent(`Range below safe distance (${distance.toFixed(2)} m)`, "WARNING");
    } else if (alertStateRef.current.rangeLow && distance >= 2.2) {
      alertStateRef.current.rangeLow = false;
      addMissionEvent(`Range recovered to safe distance (${distance.toFixed(2)} m)`, "SUCCESS");
    }

    if (
      Number.isFinite(sample.time) &&
      Number.isFinite(sample.distance) &&
      Number.isFinite(sample.roll) &&
      Number.isFinite(sample.pitch) &&
      Number.isFinite(sample.yaw)
    ) {
      setTelemetrySamples((previous) =>
        [...previous, sample].slice(-MAX_TELEMETRY_SAMPLES)
      );

      lastTelemetrySampleTimeRef.current = missionTime;
      previousRelativePositionRef.current = relativePosition;
    }
  }, [
    missionTime,
    chaserPosition,
    targetPosition,
    targetQuaternion,
    isRunning,
    telemetryUpdateRate,
    resetKey,
  ]);

  /*
   * RESET SIMULATION AND TELEMETRY HISTORY.
   */
  const resetSimulation = useCallback(() => {
    addMissionEvent("Simulation reset", "WARNING", 0);

    previousStateRef.current = {
      isRunning: false,
      isTracking,
      isRecording,
    };
    hasStartedRef.current = false;

    setIsRunning(false);
    setSimulationSpeed(1);
    simSpeedRef.current = 1;

    simTimeRef.current = 0;
    setMissionTime(0);

    chaserPosRef.current.set(INITIAL_CHASER_POSITION.x, INITIAL_CHASER_POSITION.y, INITIAL_CHASER_POSITION.z);
    targetPosRef.current.set(INITIAL_TARGET_POSITION.x, INITIAL_TARGET_POSITION.y, INITIAL_TARGET_POSITION.z);
    targetQuatRef.current.copy(INITIAL_TARGET_QUATERNION);
    angVelRef.current = { x: 0, y: 0, z: 0 };
    tumblingRateRef.current = 0;

    setChaserPosition({ ...INITIAL_CHASER_POSITION });
    setTargetPosition({ ...INITIAL_TARGET_POSITION });

    setTargetQuaternion(INITIAL_TARGET_QUATERNION.clone());
    setAngularVelocity({ x: 0, y: 0, z: 0 });
    setTumblingRate(0);

    lastTelemetrySampleTimeRef.current = null;
    previousRelativePositionRef.current = null;
    setTelemetrySamples([]);

    setSelectedObject(null);
    setTrackingTarget(null);
    setIsTracking(false);
    setIsPoseLocked(false);
    setResetKey((previousKey) => previousKey + 1);
  }, [addMissionEvent, isTracking, isRecording]);

  const initializeMissionSimulation = useCallback((config) => {
    if (!config) return;
    const chaserModel = config.chaser_model || config.chaserModel || "SpaceTug Inspector (Tri-Thruster Autonomous)";
    const targetModel = config.target_model || config.targetModel || "Soyuz-T Satellite (Cylindrical Core + Dual Arrays)";
    const orbitRegime = config.orbit_regime || config.orbitRegime || "LEO 450 km (ISS Co-Orbital Inclination 51.6°)";
    const separationDistance = Number(config.separation_distance ?? config.separationDistance ?? 15);

    setMissionConfig({
      chaserModel,
      targetModel,
      orbitRegime,
      separationDistance,
    });

    simTimeRef.current = 0;
    setMissionTime(0);
    setIsRunning(true);

    const distScale = Math.max(0.6, (separationDistance / 15) * 1.24);
    chaserPosRef.current.set(INITIAL_CHASER_POSITION.x, INITIAL_CHASER_POSITION.y, INITIAL_CHASER_POSITION.z);
    targetPosRef.current.set(ORBIT_RADIUS, 0, distScale);
    targetQuatRef.current.copy(INITIAL_TARGET_QUATERNION);

    setChaserPosition({ ...INITIAL_CHASER_POSITION });
    setTargetPosition({
      x: ORBIT_RADIUS,
      y: 0,
      z: distScale,
    });
    setTargetQuaternion(INITIAL_TARGET_QUATERNION.clone());
    setResetKey((prev) => prev + 1);

    addMissionEvent(
      `Flight plan initialized: ${config.name || "New Mission"} (${chaserModel} -> ${targetModel})`,
      "SUCCESS",
      0
    );
  }, [addMissionEvent]);

  const loadMissionIntoSimulation = useCallback((mission) => {
    if (!mission) return;
    const chaserModel = mission.chaser_model || mission.chaserModel || "SpaceTug Inspector (Tri-Thruster Autonomous)";
    const targetModel = mission.target_model || mission.targetModel || "Soyuz-T Satellite (Cylindrical Core + Dual Arrays)";
    const orbitRegime = mission.orbit_regime || mission.orbitRegime || "LEO 450 km (ISS Co-Orbital Inclination 51.6°)";
    const separationDistance = Number(mission.separation_distance ?? mission.separationDistance ?? 15);

    setMissionConfig({
      chaserModel,
      targetModel,
      orbitRegime,
      separationDistance,
    });

    const elapsed = Number(mission.elapsed_seconds || 0);
    simTimeRef.current = elapsed;
    setMissionTime(elapsed);

    const distScale = Math.max(0.6, (separationDistance / 15) * 1.24);
    chaserPosRef.current.set(INITIAL_CHASER_POSITION.x, INITIAL_CHASER_POSITION.y, INITIAL_CHASER_POSITION.z);
    targetPosRef.current.set(ORBIT_RADIUS, 0, distScale);

    setChaserPosition({ ...INITIAL_CHASER_POSITION });
    setTargetPosition({
      x: ORBIT_RADIUS,
      y: 0,
      z: distScale,
    });

    setIsRunning(mission.status === "RUNNING");
    setResetKey((prev) => prev + 1);

    addMissionEvent(
      `Restored flight plan: ${mission.name} (${mission.mission_id}) [${mission.status || "ACTIVE"}]`,
      "SUCCESS",
      elapsed
    );
  }, [addMissionEvent]);

  return (
    <SimulationContext.Provider
      value={{
        // Mission flight plan configuration
        missionConfig,
        setMissionConfig,
        initializeMissionSimulation,
        loadMissionIntoSimulation,

        // Selection and tracking
        selectedObject,
        setSelectedObject,
        trackingTarget,
        setTrackingTarget,
        isTracking,
        setIsTracking,
        isPoseLocked,
        setIsPoseLocked,
        inspectorOpen,
        setInspectorOpen,
        cameraMode,
        setCameraMode,

        // Simulation controls
        isRunning,
        setIsRunning,
        simulationSpeed,
        setSimulationSpeed,
        missionTime,
        setMissionTime,

        // High-performance physics refs (direct 60 FPS WebGL access)
        chaserPosRef,
        targetPosRef,
        targetQuatRef,
        angVelRef,
        tumblingRateRef,
        simTimeRef,

        // Recording UI state
        isRecording,
        setIsRecording,

        // Mission events
        missionEvents,
        addMissionEvent,
        setMissionEvents,

        // Shared telemetry
        telemetrySamples,
        telemetryUpdateRate,
        setTelemetryUpdateRate,

        // Reset
        resetKey,
        resetSimulation,

        // Spacecraft positions and orientation (throttled for UI)
        chaserPosition,
        setChaserPosition,
        targetPosition,
        setTargetPosition,
        targetQuaternion,
        setTargetQuaternion,
        angularVelocity,
        tumblingRate,

        // Active IR Floodlight
        irFloodlight,
        setIrFloodlight,

        // Orbit constants
        CHASER_ORBIT_X,
        CHASER_ORBIT_Z,
        TARGET_ORBIT_X,
        TARGET_ORBIT_Z,
      }}
    >
      {children}
    </SimulationContext.Provider>
  );
}

export { SimulationProvider };

export function useSimulation() {
  return useContext(SimulationContext);
}
