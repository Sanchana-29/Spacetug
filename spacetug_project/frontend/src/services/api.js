const API_BASE_URL = "http://127.0.0.1:8000";

async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}

export async function getSystemStatus() {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/status`, {}, 3000);
  if (!response.ok) {
    throw new Error(`Failed to fetch system status (${response.status})`);
  }
  return response.json();
}

export async function getHealthStatus() {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/health`, {}, 3000);
  if (!response.ok) {
    throw new Error(`Failed to fetch backend health (${response.status})`);
  }
  return response.json();
}

export async function getDatabaseHealth() {
  const response = await fetchWithTimeout(`${API_BASE_URL}/health/db`, {}, 3000);
  if (!response.ok) {
    return { status: "Disconnected", connected: false };
  }
  return response.json();
}

export async function getMissionLogs(missionId = null, limit = 50) {
  const q = missionId ? `?mission_id=${encodeURIComponent(missionId)}&limit=${limit}` : `?limit=${limit}`;
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/mission-logs${q}`, {}, 3000);
  if (!response.ok) {
    return [];
  }
  return response.json();
}

export async function createMissionLog(eventData) {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/mission-logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(eventData),
  }, 4000);
  if (!response.ok) {
    throw new Error("Failed to record mission log");
  }
  return response.json();
}

export async function getMissions(limit = 20) {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/missions?limit=${limit}`, {}, 3000);
  if (!response.ok) {
    throw new Error("Failed to fetch missions");
  }
  return response.json();
}

export async function createMission(missionData) {
  const response = await fetch(`${API_BASE_URL}/api/missions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(missionData),
  });
  if (!response.ok) {
    throw new Error("Failed to create mission");
  }
  return response.json();
}

export async function updateMission(missionId, updateData) {
  const response = await fetch(`${API_BASE_URL}/api/missions/${missionId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updateData),
  });
  if (!response.ok) {
    throw new Error("Failed to update mission");
  }
  return response.json();
}

export async function getSensorData() {
  const response = await fetch(`${API_BASE_URL}/api/sensors`);
  if (!response.ok) {
    throw new Error("Failed to fetch sensor data");
  }
  return response.json();
}

export async function getDetectionData() {
  const response = await fetch(`${API_BASE_URL}/api/detection`);
  if (!response.ok) {
    throw new Error("Failed to fetch detection data");
  }
  return response.json();
}

export async function getRecentDetections(limit = 10, missionId = null) {
  const url = missionId
    ? `${API_BASE_URL}/api/detections?limit=${limit}&mission_id=${encodeURIComponent(missionId)}`
    : `${API_BASE_URL}/api/detections?limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch detections");
  }
  return response.json();
}

export async function getRecentPoses(limit = 10, missionId = null) {
  const url = missionId
    ? `${API_BASE_URL}/api/poses?limit=${limit}&mission_id=${encodeURIComponent(missionId)}`
    : `${API_BASE_URL}/api/poses?limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch poses");
  }
  return response.json();
}

export async function getTargets() {
  const response = await fetch(`${API_BASE_URL}/api/targets`);
  if (!response.ok) {
    throw new Error("Failed to fetch targets");
  }
  return response.json();
}

export async function updateTarget(targetId, updateData) {
  const response = await fetch(`${API_BASE_URL}/api/targets/${targetId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updateData),
  });
  if (!response.ok) {
    throw new Error("Failed to update target spacecraft");
  }
  return response.json();
}

export async function getSimulationSessions(limit = 10, missionId = null) {
  const url = missionId
    ? `${API_BASE_URL}/api/simulation/sessions?limit=${limit}&mission_id=${encodeURIComponent(missionId)}`
    : `${API_BASE_URL}/api/simulation/sessions?limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch simulation sessions");
  }
  return response.json();
}

export async function saveSimulationSession(sessionData) {
  const response = await fetch(`${API_BASE_URL}/api/simulation/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sessionData),
  });
  if (!response.ok) {
    throw new Error("Failed to save simulation session");
  }
  return response.json();
}

export async function getActivityLogs(limit = 20) {
  const response = await fetch(`${API_BASE_URL}/api/activity?limit=${limit}`);
  if (!response.ok) {
    throw new Error("Failed to fetch activity logs");
  }
  return response.json();
}

export async function getUserSettings() {
  const response = await fetch(`${API_BASE_URL}/api/settings`);
  if (!response.ok) {
    throw new Error("Failed to fetch user settings");
  }
  return response.json();
}

export async function saveUserSettings(settings) {
  const response = await fetch(`${API_BASE_URL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    throw new Error("Failed to save user settings");
  }
  return response.json();
}

export async function resetUserSettings() {
  const response = await fetch(`${API_BASE_URL}/api/settings/reset`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("Failed to reset settings");
  }
  return response.json();
}

/**
 * Converts Base64 Data URL to binary Blob object for multipart/form-data upload
 */
export function dataURLtoBlob(dataurl) {
  const arr = dataurl.split(",");
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * Sends captured sensor image Blob to FastAPI detection endpoint
 */
export async function runDetectionApi(imageBlob, confidence = 0.25, sensorName = "RGB-D Camera", frameId = null, missionId = null) {
  const formData = new FormData();
  formData.append("file", imageBlob, "captured_frame.png");
  formData.append("conf", String(confidence));
  if (sensorName) formData.append("sensor_name", sensorName);
  if (frameId) formData.append("frame_id", frameId);
  if (missionId) formData.append("mission_id", missionId);

  const response = await fetch(
    `${API_BASE_URL}/api/detection/run?conf=${encodeURIComponent(confidence)}`,
    {
      method: "POST",
      body: formData,
    }
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Detection API failed [${response.status}]: ${errorText}`);
  }

  return response.json();
}

/**
 * Executes OpenCV image preprocessing pipeline
 */
export async function runImageProcessingPipelineApi(imageBlob, params = {}) {
  const formData = new FormData();
  formData.append("file", imageBlob, "source_frame.png");
  formData.append("brightness", String(params.brightness || 0));
  formData.append("contrast", String(params.contrast || 1.0));
  formData.append("grayscale", String(Boolean(params.grayscale)));
  formData.append("gaussian_blur", String(params.gaussian_blur || 0));
  formData.append("median_blur", String(params.median_blur || 0));
  formData.append("blur_mode", String(params.blur_mode || "gaussian"));
  formData.append("sharpen", String(Boolean(params.sharpen)));
  formData.append("denoise", String(Boolean(params.denoise)));
  formData.append("edge_detection", String(Boolean(params.edge_detection)));
  formData.append("edge_operator", String(params.edge_operator || "canny"));

  const response = await fetch(`${API_BASE_URL}/api/pipeline/process`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Pipeline processing failed [${response.status}]: ${errorText}`);
  }

  return response.json();
}

export async function getPoseLandmarksApi() {
  const response = await fetchWithTimeout(`${API_BASE_URL}/api/pose/landmarks`, {}, 3000);
  if (!response.ok) {
    throw new Error("Failed to fetch landmark definitions");
  }
  return response.json();
}

export async function runPoseEstimationApi(payload) {
  const response = await fetch(`${API_BASE_URL}/api/pose/estimate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.detail || "Pose estimation request failed");
  }

  return result;
}

export function getExportUrl(type, missionId = null) {
  const q = missionId ? `?mission_id=${encodeURIComponent(missionId)}` : "";
  switch (type) {
    case "detections-csv":
      return `${API_BASE_URL}/api/export/detections/csv${q}`;
    case "detections-json":
      return `${API_BASE_URL}/api/export/detections/json${q}`;
    case "poses-csv":
      return `${API_BASE_URL}/api/export/poses/csv${q}`;
    case "mission-report":
      return `${API_BASE_URL}/api/export/mission-report${q}`;
    default:
      return null;
  }
}