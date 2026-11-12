import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getMissions, createMission, updateMission, getUserSettings } from "../services/api";

const MissionContext = createContext(null);

const ACTIVE_MISSION_KEY = "spacecraft_active_mission";

export function MissionProvider({ children }) {
  const [missions, setMissions] = useState([]);
  const [activeMission, setActiveMissionState] = useState(() => {
    try {
      const saved = sessionStorage.getItem(ACTIVE_MISSION_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [loadingMissions, setLoadingMissions] = useState(false);

  const setActiveMission = useCallback((mission) => {
    setActiveMissionState(mission);
    try {
      if (mission) {
        sessionStorage.setItem(ACTIVE_MISSION_KEY, JSON.stringify(mission));
      } else {
        sessionStorage.removeItem(ACTIVE_MISSION_KEY);
      }
    } catch (e) {
      console.warn("Could not cache active mission:", e);
    }
  }, []);

  const loadMissionsList = useCallback(async () => {
    setLoadingMissions(true);
    try {
      const list = await getMissions(50);
      if (Array.isArray(list)) {
        setMissions(list);
        try {
          localStorage.setItem("spacecraft_saved_missions", JSON.stringify(list));
        } catch {}
        if (list.length > 0) {
          setActiveMissionState((curr) => {
            if (curr) {
              const found = list.find((m) => m.mission_id === curr.mission_id);
              if (found) return found;
            }
            const running = list.find((m) => m.status === "RUNNING");
            const selected = running || list[0];
            try {
              sessionStorage.setItem(ACTIVE_MISSION_KEY, JSON.stringify(selected));
            } catch {}
            return selected;
          });
        } else {
          setActiveMissionState(null);
          try {
            sessionStorage.removeItem(ACTIVE_MISSION_KEY);
          } catch {}
        }
        return list;
      }
    } catch (err) {
      console.warn("Could not load missions from backend, checking local cache:", err);
      try {
        const cached = JSON.parse(localStorage.getItem("spacecraft_saved_missions") || "[]");
        if (cached && cached.length > 0) {
          setMissions(cached);
          return cached;
        }
      } catch {}
      return [];
    } finally {
      setLoadingMissions(false);
    }
  }, []);

  useEffect(() => {
    loadMissionsList();
  }, [loadMissionsList]);

  const startNewMission = async (nameOrConfig, targetId = "SAT-001", sensorSelected = "RGB-D Camera", notes = "") => {
    const isObj = typeof nameOrConfig === "object" && nameOrConfig !== null;
    const payload = isObj
      ? {
          name: nameOrConfig.name || "Orbital Rendezvous Alpha",
          target_id: nameOrConfig.target_id || nameOrConfig.targetId || "SAT-001",
          sensor_selected: nameOrConfig.sensor_selected || nameOrConfig.sensorSelected || "RGB-D Camera",
          notes: nameOrConfig.notes || "Flight plan initialized",
          chaser_model: nameOrConfig.chaser_model || nameOrConfig.chaserModel,
          target_model: nameOrConfig.target_model || nameOrConfig.targetModel,
          orbit_regime: nameOrConfig.orbit_regime || nameOrConfig.orbitRegime,
          separation_distance: nameOrConfig.separation_distance !== undefined ? nameOrConfig.separation_distance : nameOrConfig.separationDistance,
        }
      : {
          name: nameOrConfig,
          target_id: targetId,
          sensor_selected: sensorSelected,
          notes,
        };

    try {
      const created = await createMission(payload);
      setActiveMission(created);
      await loadMissionsList();
      return created;
    } catch (err) {
      console.warn("Failed to create mission on backend, storing locally:", err);
      const fallbackCreated = {
        mission_id: `MSN-${Date.now()}`,
        name: payload.name,
        status: "RUNNING",
        target_id: payload.target_id || "SAT-001",
        sensor_selected: payload.sensor_selected || "RGB-D Camera",
        chaser_model: payload.chaser_model || "SpaceTug Inspector (Tri-Thruster Autonomous)",
        target_model: payload.target_model || "Soyuz-T Satellite (Cylindrical Core + Dual Arrays)",
        orbit_regime: payload.orbit_regime || "LEO 450 km (ISS Co-Orbital Inclination 51.6°)",
        separation_distance: payload.separation_distance !== undefined ? Number(payload.separation_distance) : 15,
        start_time: new Date().toISOString(),
        created_at: new Date().toISOString(),
        elapsed_seconds: 0.0,
        notes: payload.notes || "Flight plan initialized",
      };

      setActiveMission(fallbackCreated);
      setMissions((prev) => {
        const updated = [fallbackCreated, ...prev.filter((m) => m.mission_id !== fallbackCreated.mission_id)];
        try {
          localStorage.setItem("spacecraft_saved_missions", JSON.stringify(updated));
        } catch {}
        return updated;
      });
      return fallbackCreated;
    }
  };

  const updateActiveMissionStatus = async (status, elapsedSeconds = null) => {
    if (!activeMission) return null;
    try {
      const payload = { status };
      if (elapsedSeconds !== null) payload.elapsed_seconds = elapsedSeconds;
      const updated = await updateMission(activeMission.mission_id, payload);
      setActiveMission(updated);
      setMissions((prev) =>
        prev.map((m) => (m.mission_id === updated.mission_id ? updated : m))
      );
      return updated;
    } catch (err) {
      console.error("Failed to update mission status:", err);
      throw err;
    }
  };

  const value = {
    missions,
    activeMission,
    setActiveMission,
    loadingMissions,
    loadMissionsList,
    startNewMission,
    updateActiveMissionStatus,
  };

  return <MissionContext.Provider value={value}>{children}</MissionContext.Provider>;
}

export function useMission() {
  const context = useContext(MissionContext);
  if (!context) {
    throw new Error("useMission must be used within a MissionProvider.");
  }
  return context;
}
